import { InternalServerErrorException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

/** The customer's wallet balance is the credits minus debits on this account. */
export const USER_WALLET = "user_wallet";
export const GATEWAY_CLEARING = "gateway_clearing";
export const operatorPayable = (orgId: string) => `operator_payable:${orgId}`;
/** Money owed to a partner bus inventory provider for tickets it issued. */
export const partnerPayable = (providerId: string) => `partner_payable:${providerId}`;

export interface JournalLine {
  account: string;
  walletId?: string;
  debitPaise?: number;
  creditPaise?: number;
  memo?: string;
}

/** Write one balanced double-entry journal. Must run inside a transaction. */
export async function postJournal(tx: Prisma.TransactionClient, lines: JournalLine[]): Promise<string> {
  const debits = lines.reduce((s, l) => s + (l.debitPaise ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (l.creditPaise ?? 0), 0);
  if (debits !== credits || debits <= 0) {
    throw new InternalServerErrorException(`Unbalanced journal: debits ${debits}, credits ${credits}`);
  }
  const journalId = randomUUID();
  await tx.ledgerEntry.createMany({
    data: lines.map((l) => ({
      journalId,
      account: l.account,
      walletId: l.walletId,
      debitPaise: l.debitPaise ?? 0,
      creditPaise: l.creditPaise ?? 0,
      memo: l.memo,
    })),
  });
  return journalId;
}

export async function walletBalance(tx: Prisma.TransactionClient, walletId: string): Promise<number> {
  const agg = await tx.ledgerEntry.aggregate({
    where: { walletId, account: USER_WALLET },
    _sum: { creditPaise: true, debitPaise: true },
  });
  return (agg._sum.creditPaise ?? 0) - (agg._sum.debitPaise ?? 0);
}

/** Row lock so two payments from one wallet cannot both pass the balance check. */
export async function lockWallet(tx: Prisma.TransactionClient, walletId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "WalletAccount" WHERE id = ${walletId} FOR UPDATE`;
}
