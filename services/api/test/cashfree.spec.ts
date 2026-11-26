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
});
