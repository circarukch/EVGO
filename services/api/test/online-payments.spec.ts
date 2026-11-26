import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PAYMENT_GATEWAY } from "../src/payments/gateway";
import { MockPaymentGateway, MOCK_WEBHOOK_SECRET, signWebhook } from "../src/payments/mock.gateway";
import { createApp, db, login } from "./helpers";

const ADMIN = { "x-admin-key": "dev-admin-key" };

/** Tickets and wallet top-ups paid on Cashfree's checkout (the mock here), and refunds back to source. */
describe("Online payments through the gateway", () => {
  let app: INestApplication;
  let gw: MockPaymentGateway;
  let tripId: string;
  let fare: number;

  beforeAll(async () => {
    app = await createApp();
    gw = app.get(PAYMENT_GATEWAY);
    const trips = (await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200)).body;
    const target = trips.find(
      (t: { departsAt: string; busType: string }) => t.busType === "e-bus AC seater" && new Date(t.departsAt).getTime() - Date.now() > 96 * 3_600_000,
    );
    tripId = target.id;
    fare = target.fareInr * 100;
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const hold = (token: string, seat: string) =>
    request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: seat, passengerName: "Uma" }] }).expect(201);
  const balance = async (token: string) => (await request(http()).get("/v1/wallet").set(as(token)).expect(200)).body.balancePaise;
  const ledgerBalanced = async () => {
    const sums = await db(app).ledgerEntry.aggregate({ _sum: { debitPaise: true, creditPaise: true } });
    expect(sums._sum.debitPaise).toBe(sums._sum.creditPaise);
  };

  it("adds money to the wallet by card on the checkout", async () => {
    const token = await login(app);
    const t = await request(http()).post("/v1/wallet/topups").set(as(token)).send({ amountPaise: 75_000 }).expect(201);
    expect(t.body).toMatchObject({ status: "PENDING", gateway: "mock", checkout: { gatewayOrderId: `topup_${t.body.topUpId}`, paymentSessionId: expect.stringMatching(/^mock_session_topup_/) } });
    expect((await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/check`).set(as(token)).expect(201)).body.status).toBe("PENDING");
    const done = await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set(as(token)).send({ method: "card" }).expect(201);
    expect(done.body).toMatchObject({ status: "SUCCEEDED", balancePaise: 75_000 });
    const w = (await request(http()).get("/v1/wallet").set(as(token)).expect(200)).body;
    expect(w.history[0].memo).toBe("Added money to wallet by card");
    await ledgerBalanced();
  });

  it("does not credit a top-up whose payment failed", async () => {
    const token = await login(app);
    const t = await request(http()).post("/v1/wallet/topups").set(as(token)).send({ amountPaise: 10_000 }).expect(201);
    gw.fail(`topup_${t.body.topUpId}`);
    expect((await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/check`).set(as(token)).expect(201)).body.status).toBe("FAILED");
    expect(await balance(token)).toBe(0);
  });

  it("sells a ticket paid by UPI without touching the wallet, and refunds 90% back to UPI on cancel", async () => {
    const token = await login(app);
    const h = await hold(token, "S31");
    const co = await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout`).set(as(token)).expect(201);
    expect(co.body).toMatchObject({ gateway: "mock", amountPaise: fare, checkout: { gatewayOrderId: expect.stringMatching(/^ord_/), paymentSessionId: expect.stringMatching(/^mock_session_ord_/) } });
    expect((await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout/check`).set(as(token)).expect(201)).body.status).toBe("PENDING");

    const paid = await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout/mock-pay`).set(as(token)).send({ method: "upi" }).expect(201);
    expect(paid.body).toMatchObject({ status: "PAID", payment: { method: "upi" } });
    expect(paid.body.tickets).toHaveLength(1);
    // Checking again (app and webhook both) changes nothing.
    const again = await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout/check`).set(as(token)).expect(201);
    expect(again.body).toMatchObject({ status: "PAID", tickets: [{ ticketCode: paid.body.tickets[0].ticketCode }] });
    expect(await balance(token)).toBe(0);

    const mine = (await request(http()).get("/v1/bookings").set(as(token)).expect(200)).body;
    expect(mine[0].payment).toMatchObject({ method: "upi", amountPaise: fare });

    const c = await request(http()).post(`/v1/bookings/${h.body.orderId}/cancel`).set(as(token)).expect(201);
    const refund = Math.floor(fare * 0.9);
    expect(c.body).toMatchObject({ refundPaise: refund, refundTo: "upi", refundStatus: "SUCCEEDED" });
    expect(await balance(token)).toBe(0); // went back to UPI, not the wallet
    const rows = await db(app).refund.findMany({ where: { payment: { orderId: h.body.orderId } } });
    expect(rows).toEqual([expect.objectContaining({ amountPaise: refund, status: "SUCCEEDED" })]);
    await ledgerBalanced();
  });

  it("refunds in full if the payment lands after the seat was given to someone else", async () => {
    const a = await login(app);
    const b = await login(app);
    const h = await hold(a, "S32");
    await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout`).set(as(a)).expect(201);
    const past = new Date(Date.now() - 1000);
    await db(app).tripSeatInventory.updateMany({ where: { holdOrderId: h.body.orderId }, data: { heldUntil: past } });
    await db(app).order.update({ where: { id: h.body.orderId }, data: { expiresAt: past } });
    await hold(b, "S32");

    const late = await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout/mock-pay`).set(as(a)).send({ method: "netbanking" }).expect(201);
    expect(late.body).toMatchObject({ status: "CANCELLED", tickets: [], refunds: [{ amountPaise: fare, status: "SUCCEEDED" }] });
    expect(late.body.message).toMatch(/full amount/);
  });

  it("keeps a refund the gateway could not take, and sends it on retry", async () => {
    const token = await login(app);
    const h = await hold(token, "S33");
    await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout`).set(as(token)).expect(201);
    await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout/mock-pay`).set(as(token)).send({ method: "card" }).expect(201);
    gw.failNextRefund = true;
    const c = await request(http()).post(`/v1/bookings/${h.body.orderId}/cancel`).set(as(token)).expect(201);
    expect(c.body).toMatchObject({ refundTo: "card", refundStatus: "PENDING" });
    const pending = (await request(http()).get("/v1/admin/refunds?status=PENDING").set(ADMIN).expect(200)).body;
    expect(pending.find((r: { orderId: string }) => r.orderId === h.body.orderId)).toMatchObject({ method: "card", lastError: "Gateway did not respond" });

    const retried = await request(http()).post("/v1/admin/refunds/retry").set(ADMIN).expect(200);
    expect(retried.body.SUCCEEDED).toBeGreaterThanOrEqual(1);
    const row = await db(app).refund.findFirstOrThrow({ where: { payment: { orderId: h.body.orderId } } });
    expect(row.status).toBe("SUCCEEDED");
  });

  it("issues tickets from a signed webhook even if the app never comes back", async () => {
    const token = await login(app);
    const h = await hold(token, "S34");
    await request(http()).post(`/v1/bookings/${h.body.orderId}/checkout`).set(as(token)).expect(201);
    const p = await db(app).payment.findFirstOrThrow({ where: { orderId: h.body.orderId, status: "PENDING" } });
    gw.pay(p.gatewayRef!, "upi");

    const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: p.gatewayRef } } });
    const ts = String(Date.now());
    await request(http()).post("/v1/payments/cashfree/webhook").set({ "content-type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": "forged" }).send(body).expect(401);
    await request(http())
      .post("/v1/payments/cashfree/webhook")
      .set({ "content-type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": signWebhook(MOCK_WEBHOOK_SECRET, ts, body) })
      .send(body)
      .expect(200);
    const order = await db(app).order.findUniqueOrThrow({ where: { id: h.body.orderId } });
    expect(order.status).toBe("PAID");
  });

  it("still lets customers pay from the wallet", async () => {
    const token = await login(app);
    const t = await request(http()).post("/v1/wallet/topups").set(as(token)).send({ amountPaise: fare }).expect(201);
    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set(as(token)).expect(201);
    const h = await hold(token, "S35");
    const paid = await request(http()).post(`/v1/bookings/${h.body.orderId}/pay`).set(as(token)).expect(201);
    expect(paid.body).toMatchObject({ status: "PAID", payment: { method: "wallet" }, balancePaise: 0 });
    const c = await request(http()).post(`/v1/bookings/${h.body.orderId}/cancel`).set(as(token)).expect(201);
    expect(c.body).toMatchObject({ refundTo: "wallet", refundStatus: "SUCCEEDED" });
    expect(await balance(token)).toBe(Math.floor(fare * 0.9));
  });
});
