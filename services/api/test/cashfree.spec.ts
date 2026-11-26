import { createHmac } from "node:crypto";
import { CashfreePaymentGateway } from "../src/payments/cashfree.gateway";

/** Request shapes for Cashfree UPI pre-authorisation, checked without the network. */
describe("Cashfree gateway adapter", () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];
  const replies: Array<[number, unknown]> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = replies.shift() ?? [200, {}];
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  const cf = new CashfreePaymentGateway({ appId: "app", secretKey: "secret", baseUrl: "https://sandbox.cashfree.com", apiVersion: "2025-01-01" }, fakeFetch);
  beforeEach(() => {
    calls.length = 0;
    replies.length = 0;
  });

  it("creates an order, then asks for a UPI block with authorize_only", async () => {
    replies.push([200, { payment_session_id: "sess_1" }], [200, { data: { payload: { default: "upi://mandate?x=1" } } }]);
    const now = Date.now();
    const created = await cf.createBlock({
      ref: "evgo_abc", amountPaise: 50_000, description: "EV charging", customerId: "u1", customerPhone: "9876543210",
      approveBy: new Date(now + 300_000), expiresAt: new Date(now + 86_400_000),
    });
    expect(created).toEqual({ gatewayRef: "evgo_abc", status: "PENDING", upiIntentUrl: "upi://mandate?x=1" });
    expect(calls[0]).toMatchObject({ url: "https://sandbox.cashfree.com/pg/orders", method: "POST", body: { order_id: "evgo_abc", order_amount: 500, order_currency: "INR" } });
    expect(calls[0].headers).toMatchObject({ "x-client-id": "app", "x-client-secret": "secret", "x-api-version": "2025-01-01" });
    expect(calls[1]).toMatchObject({
      url: "https://sandbox.cashfree.com/pg/orders/sessions",
      body: { payment_session_id: "sess_1", payment_method: { upi: { channel: "link", authorize_only: true } } },
    });
  });

  it("captures part of the block, or voids it", async () => {
    await cf.capture("evgo_abc", 15_350);
    await cf.release("evgo_abc");
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ["https://sandbox.cashfree.com/pg/orders/evgo_abc/authorization", { action: "CAPTURE", amount: 153.5 }],
      ["https://sandbox.cashfree.com/pg/orders/evgo_abc/authorization", { action: "VOID" }],
    ]);
  });

  it("maps payment status to block status", async () => {
    const cases: Array<[unknown, string]> = [
      [[], "PENDING"],
      [[{ payment_status: "PENDING" }], "PENDING"],
      [[{ payment_status: "SUCCESS", authorization: { action: null, status: "PENDING" } }], "AUTHORIZED"],
      [[{ payment_status: "SUCCESS", authorization: { action: "CAPTURE", status: "SUCCESS" } }], "CAPTURED"],
      [[{ payment_status: "VOID" }], "RELEASED"],
      [[{ payment_status: "FAILED" }], "FAILED"],
    ];
    for (const [body, want] of cases) {
      replies.push([200, body]);
      expect(await cf.blockStatus("evgo_abc")).toBe(want);
    }
  });

  it("reports gateway errors by kind", async () => {
    replies.push([500, { message: "down" }]);
    await expect(cf.capture("x", 100)).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    replies.push([400, { message: "already captured" }]);
    await expect(cf.capture("x", 100)).rejects.toMatchObject({ kind: "INVALID_STATE", message: "already captured" });
  });

  it("opens a checkout order for tickets and top-ups, with the webhook address", async () => {
    const withNotify = new CashfreePaymentGateway(
      { appId: "app", secretKey: "secret", baseUrl: "https://sandbox.cashfree.com", apiVersion: "2025-01-01", notifyUrl: "https://api.evgo.in/v1/payments/cashfree/webhook" },
      fakeFetch,
    );
    replies.push([200, { payment_session_id: "sess_9" }]);
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    const c = await withNotify.createCheckout({ ref: "topup_1", amountPaise: 123_456, description: "Add money", customerId: "u1", customerPhone: "9876543210", expiresAt });
    expect(c).toEqual({ gatewayRef: "topup_1", paymentSessionId: "sess_9", environment: "SANDBOX" });
    expect(calls[0].body).toMatchObject({
      order_id: "topup_1",
      order_amount: 1234.56,
      order_expiry_time: expiresAt.toISOString(),
      order_meta: { notify_url: "https://api.evgo.in/v1/payments/cashfree/webhook" },
    });
  });

  it("reads a paid order and how it was paid", async () => {
    replies.push([200, { order_status: "PAID" }], [200, [{ payment_status: "FAILED", payment_group: "upi" }, { payment_status: "SUCCESS", payment_group: "debit_card", cf_payment_id: 555 }]]);
    expect(await cf.checkoutStatus("ord_1")).toEqual({ status: "PAID", method: "card", paymentRef: "555" });
    replies.push([200, { order_status: "ACTIVE" }]);
    expect((await cf.checkoutStatus("ord_1")).status).toBe("PENDING");
    replies.push([200, { order_status: "EXPIRED" }]);
    expect((await cf.checkoutStatus("ord_1")).status).toBe("EXPIRED");
  });

  it("refunds part of an order with our refund id, and reads refund status", async () => {
    replies.push([200, { refund_status: "PENDING", cf_refund_id: 77 }], [200, { refund_status: "SUCCESS" }]);
    expect(await cf.refund({ gatewayRef: "ord_1", refundRef: "rf-1", amountPaise: 45_000, reason: "Cancelled" })).toEqual({ status: "PENDING", gatewayRefundId: "77" });
    expect(await cf.refundStatus("ord_1", "rf-1")).toBe("SUCCEEDED");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "https://sandbox.cashfree.com/pg/orders/ord_1/refunds", { refund_amount: 450, refund_id: "rf-1", refund_note: "Cancelled" }],
      ["GET", "https://sandbox.cashfree.com/pg/orders/ord_1/refunds/rf-1", undefined],
    ]);
  });

  it("accepts only webhooks signed with our secret key, and not old ones", () => {
    const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const ts = String(Date.now());
    const sig = createHmac("sha256", "secret").update(ts + body).digest("base64");
    expect(cf.verifyWebhook(body, ts, sig)).toBe(true);
    expect(cf.verifyWebhook(body + " ", ts, sig)).toBe(false);
    expect(cf.verifyWebhook(body, ts, createHmac("sha256", "other").update(ts + body).digest("base64"))).toBe(false);
    const old = String(Date.now() - 3_600_000);
    expect(cf.verifyWebhook(body, old, createHmac("sha256", "secret").update(old + body).digest("base64"))).toBe(false);
  });
});
