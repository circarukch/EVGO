import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PAYMENT_GATEWAY, PaymentGateway, RefundState } from "./gateway";

/**
 * Sends money back through the gateway to the UPI, card or bank account it came from.
 * A refund row is written first (inside the caller's transaction), then sent. If the gateway is
 * down the row stays PENDING with the error, and retryPending() sends it again later; the
 * gateway ignores a refund id it has already seen, so retrying never refunds twice.
 */
@Injectable()
export class RefundsService {
  private readonly log = new Logger(RefundsService.name);
  constructor(
    private readonly db: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  get gatewayName() {
    return this.gateway.name;
  }

  async send(refundId: string): Promise<RefundState> {
    const r = await this.db.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    if (r.status !== "PENDING") return r.status as RefundState;
    if (r.gatewayRef) return this.sync(refundId); // already accepted: just ask how it went
    try {
      const res = await this.gateway.refund({ gatewayRef: r.payment.gatewayRef!, refundRef: r.id, amountPaise: r.amountPaise, reason: r.reason ?? "EVGO refund" });
      await this.db.refund.update({ where: { id: r.id }, data: { status: res.status, gatewayRef: res.gatewayRefundId ?? r.id, lastError: null } });
      return res.status;
    } catch (e) {
      this.log.warn(`refund ${r.id} not sent yet: ${(e as Error).message}`);
      await this.db.refund.update({ where: { id: r.id }, data: { lastError: (e as Error).message.slice(0, 300) } });
      return "PENDING";
    }
  }

  /** Bring an accepted refund up to date with the gateway. */
  async sync(refundId: string): Promise<RefundState> {
    const r = await this.db.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
    if (r.status !== "PENDING") return r.status as RefundState;
    try {
      const status = await this.gateway.refundStatus(r.payment.gatewayRef!, r.id);
      if (status !== "PENDING") await this.db.refund.update({ where: { id: r.id }, data: { status } });
      return status;
    } catch {
      return "PENDING";
    }
  }

  /** From Cashfree's refund webhook. */
  async markFromWebhook(refundId: string, status: RefundState) {
    await this.db.refund.updateMany({ where: { id: refundId, status: "PENDING" }, data: { status } });
  }

  /** Send refunds the gateway has not taken yet, and check on ones still in progress. */
  async retryPending() {
    const pending = await this.db.refund.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 100 });
    const results: Record<string, number> = { SUCCEEDED: 0, PENDING: 0, FAILED: 0 };
    for (const r of pending) results[await this.send(r.id)]++;
    return { checked: pending.length, ...results };
  }

  async list(status?: string) {
    const rows = await this.db.refund.findMany({
      where: status ? { status } : {},
      include: { payment: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      orderId: r.payment.orderId,
      amountPaise: r.amountPaise,
      method: r.payment.method,
      status: r.status,
      reason: r.reason,
      lastError: r.lastError,
      createdAt: r.createdAt,
    }));
  }
}
