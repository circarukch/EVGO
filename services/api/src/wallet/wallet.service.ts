import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { config } from "../config";
import { PAYMENT_GATEWAY, PaymentGateway } from "../payments/gateway";
import { checkoutRef, gatewayCall } from "../payments/gateway-call";
import { MockPaymentGateway } from "../payments/mock.gateway";
import { PrismaService } from "../prisma/prisma.service";
import { GATEWAY_CLEARING, postJournal, USER_WALLET, walletBalance } from "./ledger";

const METHOD_LABEL: Record<string, string> = { upi: "UPI", card: "card", netbanking: "netbanking", app_wallet: "wallet app" };

@Injectable()
export class WalletService {
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

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

  /**
   * Step 1 of a top-up: a Cashfree order. The app opens Cashfree's checkout with paymentSessionId,
   * where the customer pays by UPI, card or netbanking, then calls check (or the webhook arrives).
   */
  async createTopUp(userId: string, amountPaise: number) {
    if (!Number.isInteger(amountPaise) || amountPaise < config.topUpMinPaise || amountPaise > config.topUpMaxPaise) {
      throw new BadRequestException(`Top-up must be between ₹${(config.topUpMinPaise / 100).toLocaleString("en-IN")} and ₹${(config.topUpMaxPaise / 100).toLocaleString("en-IN")}`);
    }
    const wallet = await this.walletFor(userId);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const topUp = await this.db.topUp.create({ data: { walletId: wallet.id, amountPaise } });
    const ref = checkoutRef.topUp(topUp.id);
    const checkout = await gatewayCall(() =>
      this.gateway.createCheckout({
        ref,
        amountPaise,
        description: "Add money to EVGO wallet",
        customerId: userId,
        customerPhone: user.phone,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
    ).catch(async (e) => {
      await this.db.topUp.update({ where: { id: topUp.id }, data: { status: "FAILED" } });
      throw e;
    });
    await this.db.topUp.update({ where: { id: topUp.id }, data: { gatewayRef: checkout.gatewayRef } });
    return {
      topUpId: topUp.id,
      amountPaise,
      status: topUp.status,
      gateway: this.gateway.name,
      checkout: { gatewayOrderId: checkout.gatewayRef, paymentSessionId: checkout.paymentSessionId, environment: checkout.environment ?? null },
    };
  }

  /** Ask the gateway whether the top-up was paid, and credit the wallet if so. Safe to call again. */
  async checkTopUp(userId: string | null, topUpId: string) {
    const topUp = await this.db.topUp.findUnique({ where: { id: topUpId }, include: { wallet: true } });
    if (!topUp) throw new NotFoundException("Top-up not found");
    if (userId && topUp.wallet.userId !== userId) throw new ForbiddenException();
    if (topUp.status !== "PENDING" || !topUp.gatewayRef) {
      return { topUpId, status: topUp.status, balancePaise: await walletBalance(this.db, topUp.walletId) };
    }
    const at = await gatewayCall(() => this.gateway.checkoutStatus(topUp.gatewayRef!));
    if (at.status === "PAID") return this.confirmTopUp(topUpId, topUp.gatewayRef, at.method);
    if (at.status === "FAILED" || at.status === "EXPIRED") {
      await this.db.topUp.updateMany({ where: { id: topUpId, status: "PENDING" }, data: { status: "FAILED" } });
      return { topUpId, status: "FAILED" as const, balancePaise: await walletBalance(this.db, topUp.walletId) };
    }
    return { topUpId, status: "PENDING" as const, balancePaise: await walletBalance(this.db, topUp.walletId) };
  }

  /**
   * Step 2: the payment gateway reports success (webhook, signature checked by the caller).
   * Idempotent: a repeated webhook does not credit twice.
   */
  async confirmTopUp(topUpId: string, gatewayRef: string, method = "online") {
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
          { account: USER_WALLET, walletId: topUp.walletId, creditPaise: topUp.amountPaise, memo: `Added money to wallet${METHOD_LABEL[method] ? ` by ${METHOD_LABEL[method]}` : ""}` },
        ]);
      }
      return { topUpId, status: "SUCCEEDED" as const, balancePaise: await walletBalance(tx, topUp.walletId) };
    });
  }

  /** Development and demo: stands in for the customer paying on Cashfree's checkout. */
  async mockConfirm(userId: string, topUpId: string, method = "upi") {
    if (!config.mockPayments || !(this.gateway instanceof MockPaymentGateway)) throw new NotFoundException();
    const wallet = await this.walletFor(userId);
    const topUp = await this.db.topUp.findUnique({ where: { id: topUpId } });
    if (!topUp) throw new NotFoundException("Top-up not found");
    if (topUp.walletId !== wallet.id) throw new ForbiddenException();
    if (topUp.gatewayRef && topUp.status === "PENDING") this.gateway.pay(topUp.gatewayRef, method);
    return this.checkTopUp(userId, topUpId);
  }
}
