import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { GATEWAY_CLEARING, postJournal, USER_WALLET, walletBalance } from "./ledger";

@Injectable()
export class WalletService {
  constructor(private readonly db: PrismaService) {}

  async walletFor(userId: string) {
    return this.db.walletAccount.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  async summary(userId: string) {
    const wallet = await this.walletFor(userId);
    const [balancePaise, entries] = await Promise.all([
      walletBalance(this.db, wallet.id),
      this.db.ledgerEntry.findMany({
        where: { walletId: wallet.id, account: USER_WALLET },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return {
      balancePaise,
      history: entries.map((e) => ({
        id: e.id,
        amountPaise: e.creditPaise - e.debitPaise,
        memo: e.memo,
        at: e.createdAt,
      })),
    };
  }

  /** Step 1 of a top-up. With Razorpay or Cashfree this also creates the gateway order. */
  async createTopUp(userId: string, amountPaise: number) {
    if (!Number.isInteger(amountPaise) || amountPaise < config.topUpMinPaise || amountPaise > config.topUpMaxPaise) {
      throw new BadRequestException(`Top-up must be between ₹${config.topUpMinPaise / 100} and ₹${config.topUpMaxPaise / 100}`);
    }
    const wallet = await this.walletFor(userId);
    const topUp = await this.db.topUp.create({ data: { walletId: wallet.id, amountPaise } });
    return { topUpId: topUp.id, amountPaise, status: topUp.status, gateway: config.mockPayments ? "mock" : "razorpay" };
  }

  /**
   * Step 2: the payment gateway reports success (webhook, signature checked by the caller).
   * Idempotent: a repeated webhook does not credit twice.
   */
  async confirmTopUp(topUpId: string, gatewayRef: string) {
    return this.db.$transaction(async (tx) => {
      const topUp = await tx.topUp.findUnique({ where: { id: topUpId } });
      if (!topUp) throw new NotFoundException("Top-up not found");
      const updated = await tx.topUp.updateMany({
        where: { id: topUpId, status: "PENDING" },
        data: { status: "SUCCEEDED", gatewayRef },
      });
      if (updated.count === 1) {
        await postJournal(tx, [
          { account: GATEWAY_CLEARING, debitPaise: topUp.amountPaise, memo: `Top-up ${topUpId}` },
          { account: USER_WALLET, walletId: topUp.walletId, creditPaise: topUp.amountPaise, memo: "Added money to wallet" },
        ]);
      }
      return { topUpId, status: "SUCCEEDED" as const, balancePaise: await walletBalance(tx, topUp.walletId) };
    });
  }

  /** Development stand-in for the gateway checkout and webhook. */
  async mockConfirm(userId: string, topUpId: string) {
    if (!config.mockPayments) throw new NotFoundException();
    const wallet = await this.walletFor(userId);
    const topUp = await this.db.topUp.findUnique({ where: { id: topUpId } });
    if (!topUp) throw new NotFoundException("Top-up not found");
    if (topUp.walletId !== wallet.id) throw new ForbiddenException();
    return this.confirmTopUp(topUpId, `mock_${topUpId}`);
  }
}
