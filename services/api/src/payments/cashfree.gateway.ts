import { BlockStatus, CreateBlockInput, CreatedBlock, PaymentGateway, PaymentGatewayError } from "./gateway";

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  baseUrl: string; // https://sandbox.cashfree.com or https://api.cashfree.com
  apiVersion: string;
}

/**
 * Cashfree Payment Gateway, UPI pre-authorisation:
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
}
