import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BlockStatus,
  CheckoutStatus,
  CreateBlockInput,
  CreateCheckoutInput,
  CreatedBlock,
  CreatedCheckout,
  PaymentGateway,
  PaymentGatewayError,
  RefundInput,
  RefundState,
} from "./gateway";

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  baseUrl: string; // https://sandbox.cashfree.com or https://api.cashfree.com
  apiVersion: string;
  notifyUrl?: string;
}

/** Cashfree's payment_group, in our words. */
const METHOD: Record<string, string> = {
  upi: "upi",
  credit_card: "card",
  debit_card: "card",
  prepaid_card: "card",
  net_banking: "netbanking",
  wallet: "app_wallet",
  pay_later: "paylater",
  cardless_emi: "emi",
  credit_card_emi: "emi",
  debit_card_emi: "emi",
};

function refundState(s: string | undefined): RefundState {
  if (s === "SUCCESS") return "SUCCEEDED";
  if (s === "CANCELLED" || s === "FAILED") return "FAILED";
  return "PENDING"; // PENDING, ONHOLD
}

/**
 * Cashfree Payment Gateway (PG API, x-api-version 2025-01-01).
 *
 * Checkout (tickets, top-ups): POST /pg/orders gives a payment_session_id; the app opens Cashfree's
 * checkout with it (Flutter SDK / JS SDK) where the customer pays by UPI, card, netbanking or a wallet
 * app. GET /pg/orders/:id says whether it is PAID. Refunds: POST /pg/orders/:id/refunds.
 * Webhooks are signed: base64(HMAC-SHA256(timestamp + raw body, secret key)).
 *
 * UPI pre-authorisation (charging):
 *   create order → Order Pay with upi.authorize_only (intent link) → customer approves in UPI app
 *   → POST /pg/orders/:id/authorization {action: CAPTURE, amount} (partial allowed) or {action: VOID}.
 * Needs pre-authorisation enabled on EVGO's Cashfree account. Not yet run against the sandbox:
 * test with sandbox keys before switching PAYMENT_GATEWAY=cashfree.
 */
export class CashfreePaymentGateway implements PaymentGateway {
  readonly name = "cashfree";
  constructor(
    private readonly cfg: CashfreeConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-version": this.cfg.apiVersion,
          "x-client-id": this.cfg.appId,
          "x-client-secret": this.cfg.secretKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new PaymentGatewayError("UNAVAILABLE", "Cashfree did not respond");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const kind = res.status >= 500 ? "UNAVAILABLE" : "INVALID_STATE";
      throw new PaymentGatewayError(kind, String(json.message ?? `Cashfree error ${res.status}`));
    }
    return json as T;
  }

  async createBlock(input: CreateBlockInput): Promise<CreatedBlock> {
    const order = await this.call<{ payment_session_id: string }>("POST", "/pg/orders", {
      order_id: input.ref,
      order_amount: input.amountPaise / 100,
      order_currency: "INR",
      order_note: input.description,
      customer_details: { customer_id: input.customerId, customer_phone: input.customerPhone },
    });
    const pay = await this.call<{ data?: { payload?: { default?: string } } }>("POST", "/pg/orders/sessions", {
      payment_session_id: order.payment_session_id,
      payment_method: {
        upi: {
          channel: "link",
          authorize_only: true,
          authorization: {
            approve_by: input.approveBy.toISOString(),
            start_time: new Date().toISOString(),
            end_time: input.expiresAt.toISOString(),
          },
        },
      },
    });
    return { gatewayRef: input.ref, status: "PENDING", upiIntentUrl: pay.data?.payload?.default };
  }

  async blockStatus(gatewayRef: string): Promise<BlockStatus> {
    const payments = await this.call<Array<{ payment_status: string; authorization?: { action?: string; status?: string } }>>(
      "GET",
      `/pg/orders/${encodeURIComponent(gatewayRef)}/payments`,
    );
    const p = payments[0];
    if (!p) return "PENDING";
    switch (p.payment_status) {
      case "PENDING":
      case "NOT_ATTEMPTED":
        return "PENDING";
      case "AUTHORIZED": // older API versions report an approved block like this
        return "AUTHORIZED";
      case "SUCCESS":
        return p.authorization?.action === "CAPTURE" ? "CAPTURED" : "AUTHORIZED";
      case "VOID":
        return "RELEASED";
      case "USER_DROPPED":
      case "FAILED":
        return "FAILED";
      default:
        return "PENDING";
    }
  }

  async capture(gatewayRef: string, amountPaise: number) {
    await this.call("POST", `/pg/orders/${encodeURIComponent(gatewayRef)}/authorization`, {
      action: "CAPTURE",
      amount: amountPaise / 100,
    });
    return { captureRef: `${gatewayRef}:capture` };
  }

  async release(gatewayRef: string) {
    await this.call("POST", `/pg/orders/${encodeURIComponent(gatewayRef)}/authorization`, { action: "VOID" });
  }

  // ---------- Checkout: one-time payments ----------

  async createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
    const order = await this.call<{ payment_session_id: string }>("POST", "/pg/orders", {
      order_id: input.ref,
      order_amount: input.amountPaise / 100,
      order_currency: "INR",
      order_note: input.description,
      order_expiry_time: input.expiresAt.toISOString(),
      customer_details: { customer_id: input.customerId, customer_phone: input.customerPhone },
      ...(this.cfg.notifyUrl ? { order_meta: { notify_url: this.cfg.notifyUrl } } : {}),
    });
    return {
      gatewayRef: input.ref,
      paymentSessionId: order.payment_session_id,
      environment: this.cfg.baseUrl.includes("sandbox") ? "SANDBOX" : "PRODUCTION",
    };
  }

  async checkoutStatus(gatewayRef: string): Promise<CheckoutStatus> {
    const order = await this.call<{ order_status: string }>("GET", `/pg/orders/${encodeURIComponent(gatewayRef)}`);
    switch (order.order_status) {
      case "PAID": {
        const payments = await this.call<Array<{ payment_status: string; payment_group?: string; cf_payment_id?: string | number }>>(
          "GET",
          `/pg/orders/${encodeURIComponent(gatewayRef)}/payments`,
        );
        const ok = payments.find((p) => p.payment_status === "SUCCESS");
        return { status: "PAID", method: METHOD[ok?.payment_group ?? ""] ?? ok?.payment_group ?? "online", paymentRef: ok?.cf_payment_id?.toString() };
      }
      case "EXPIRED":
        return { status: "EXPIRED" };
      case "TERMINATED":
      case "TERMINATION_REQUESTED":
        return { status: "FAILED" };
      default:
        return { status: "PENDING" }; // ACTIVE: not paid yet
    }
  }

  async refund(input: RefundInput) {
    const r = await this.call<{ refund_status?: string; cf_refund_id?: string | number }>(
      "POST",
      `/pg/orders/${encodeURIComponent(input.gatewayRef)}/refunds`,
      { refund_amount: input.amountPaise / 100, refund_id: input.refundRef, refund_note: input.reason.slice(0, 100) },
    );
    return { status: refundState(r.refund_status), gatewayRefundId: r.cf_refund_id?.toString() };
  }

  async refundStatus(gatewayRef: string, refundRef: string): Promise<RefundState> {
    const r = await this.call<{ refund_status?: string }>(
      "GET",
      `/pg/orders/${encodeURIComponent(gatewayRef)}/refunds/${encodeURIComponent(refundRef)}`,
    );
    return refundState(r.refund_status);
  }

  verifyWebhook(rawBody: string, timestamp: string, signature: string): boolean {
    if (!rawBody || !timestamp || !signature) return false;
    // Reject replays: Cashfree's timestamp is in milliseconds.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000) return false;
    const expected = Buffer.from(createHmac("sha256", this.cfg.secretKey).update(timestamp + rawBody).digest("base64"));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
