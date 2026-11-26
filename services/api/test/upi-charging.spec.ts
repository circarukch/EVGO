import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { CHARGER_CONTROL, SimulatedChargerControl } from "../src/charging/charger-control";
import { PAYMENT_GATEWAY } from "../src/payments/gateway";
import { MockPaymentGateway } from "../src/payments/mock.gateway";
import { createApp, db, login } from "./helpers";

describe("Charging paid by UPI, no wallet", () => {
  let app: INestApplication;
  let sim: SimulatedChargerControl;
  let gateway: MockPaymentGateway;
  beforeAll(async () => {
    app = await createApp();
    sim = app.get(CHARGER_CONTROL);
    gateway = app.get(PAYMENT_GATEWAY);
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const block = (token: string, chargePointId: string, connectorId: number, amountPaise: number) =>
    request(http()).post("/v1/charging/upi-blocks").set(as(token)).send({ chargePointId, connectorId, amountPaise });
  const status = async (cp: string, id: number) =>
    (await request(http()).get(`/v1/chargers/${cp}`).expect(200)).body.connectors.find((c: { id: number }) => c.id === id).status;

  it("blocks ₹500, starts once approved, captures only what was used and releases the rest", async () => {
    const token = await login(app); // empty wallet: none needed
    const created = await block(token, "VJW-BNZ-01", 1, 50_000).expect(201);
    expect(created.body).toMatchObject({ status: "PENDING", amountPaise: 50_000, gateway: "mock" });
    expect(created.body.upiIntentUrl).toMatch(/^upi:\/\//);

    // Not approved yet: nothing starts.
    const waiting = await request(http()).post(`/v1/charging/upi-blocks/${created.body.id}/start`).set(as(token)).expect(201);
    expect(waiting.body).toMatchObject({ block: { status: "PENDING" }, session: null });
    expect(await status("VJW-BNZ-01", 1)).toBe("Available");

    await request(http()).post(`/v1/charging/upi-blocks/${created.body.id}/mock-approve`).set(as(token)).expect(201);
    const started = await request(http()).post(`/v1/charging/upi-blocks/${created.body.id}/start`).set(as(token)).expect(201);
    expect(started.body.block.status).toBe("IN_USE");
    expect(started.body.session).toMatchObject({ status: "ACTIVE", maxCostPaise: 50_000, payment: { method: "upi", blockedPaise: 50_000 } });
    expect(await status("VJW-BNZ-01", 1)).toBe("Charging");
    // Polling again is harmless and returns the same session.
    const again = await request(http()).post(`/v1/charging/upi-blocks/${created.body.id}/start`).set(as(token)).expect(201);
    expect(again.body.session.id).toBe(started.body.session.id);

    sim.advance(10 * 60_000); // 10 min at 51 kW = 8.5 kWh × ₹18 = ₹153
    const stopped = await request(http()).post(`/v1/charging/sessions/${started.body.session.id}/stop`).set(as(token)).expect(201);
    expect(stopped.body.status).toBe("STOPPED");
    const cost = stopped.body.costPaise;
    expect(cost).toBeGreaterThan(14_000);
    expect(stopped.body.payment).toMatchObject({ method: "upi", status: "CAPTURED", capturedPaise: cost, releasedPaise: 50_000 - cost });
    expect(await status("VJW-BNZ-01", 1)).toBe("Available");

    // The wallet was never touched; the money went gateway → operator.
    const wallet = await request(http()).get("/v1/wallet").set(as(token)).expect(200);
    expect(wallet.body.balancePaise).toBe(0);
    const pay = await db(app).payment.findFirst({ where: { method: "upi", amountPaise: cost }, orderBy: { createdAt: "desc" } });
    expect(pay?.status).toBe("SUCCEEDED");
  });

  it("stops by itself when the session has used the blocked amount", async () => {
    const token = await login(app);
    const b = await block(token, "GNT-HUB-01", 1, 10_000).expect(201);
    await request(http()).post(`/v1/charging/upi-blocks/${b.body.id}/mock-approve`).set(as(token)).expect(201);
    const s = (await request(http()).post(`/v1/charging/upi-blocks/${b.body.id}/start`).set(as(token)).expect(201)).body.session;
    sim.advance(60 * 60_000);
    const view = await request(http()).get(`/v1/charging/sessions/${s.id}`).set(as(token)).expect(200);
    expect(view.body).toMatchObject({ status: "STOPPED", stopReason: "AmountLimit", costPaise: 10_000, payment: { capturedPaise: 10_000, releasedPaise: 0 } });
  });

  it("a declined or cancelled request never starts the charger", async () => {
    const token = await login(app);
    const declined = await block(token, "VJW-BNZ-01", 2, 30_000).expect(201);
    await request(http()).post(`/v1/charging/upi-blocks/${declined.body.id}/mock-decline`).set(as(token)).expect(201);
    const res = await request(http()).post(`/v1/charging/upi-blocks/${declined.body.id}/start`).set(as(token));
    expect(res.status).toBe(402);
    expect(res.body.message).toBe("The payment was not approved in your UPI app");

    const approved = await block(token, "VJW-BNZ-01", 2, 30_000).expect(201);
    await request(http()).post(`/v1/charging/upi-blocks/${approved.body.id}/mock-approve`).set(as(token)).expect(201);
    const cancelled = await request(http()).delete(`/v1/charging/upi-blocks/${approved.body.id}`).set(as(token)).expect(200);
    expect(cancelled.body.status).toBe("RELEASED");
    await request(http()).post(`/v1/charging/upi-blocks/${approved.body.id}/start`).set(as(token)).expect(402);
    expect(await status("VJW-BNZ-01", 2)).toBe("Available");
    const other = await login(app);
    await request(http()).post(`/v1/charging/upi-blocks/${approved.body.id}/start`).set(as(other)).expect(403);
  });

  it("releases the whole block when the connector was taken while the user approved", async () => {
    const a = await login(app);
    const b = await login(app);
    const blockA = await block(a, "SRY-PLZ-01", 1, 50_000);
    expect(blockA.status).toBe(201);
    const blockB = await block(b, "SRY-PLZ-01", 1, 50_000).expect(201);
    for (const [t, x] of [[a, blockA], [b, blockB]] as const) {
      await request(http()).post(`/v1/charging/upi-blocks/${x.body.id}/mock-approve`).set(as(t)).expect(201);
    }
    const first = await request(http()).post(`/v1/charging/upi-blocks/${blockA.body.id}/start`).set(as(a)).expect(201);
    const second = await request(http()).post(`/v1/charging/upi-blocks/${blockB.body.id}/start`).set(as(b));
    expect(second.status).toBe(409);
    expect((await db(app).paymentBlock.findUniqueOrThrow({ where: { id: blockB.body.id } })).status).toBe("RELEASED");
    await request(http()).post(`/v1/charging/sessions/${first.body.session.id}/stop`).set(as(a)).expect(201);
  });

  it("records what is owed when the capture fails, without touching the wallet", async () => {
    const token = await login(app);
    const b = await block(token, "VJW-BNZ-01", 1, 50_000).expect(201);
    await request(http()).post(`/v1/charging/upi-blocks/${b.body.id}/mock-approve`).set(as(token)).expect(201);
    const s = (await request(http()).post(`/v1/charging/upi-blocks/${b.body.id}/start`).set(as(token)).expect(201)).body.session;
    sim.advance(5 * 60_000);
    gateway.failNextCapture = true;
    const stopped = await request(http()).post(`/v1/charging/sessions/${s.id}/stop`).set(as(token)).expect(201);
    expect(stopped.body.payment).toMatchObject({ status: "CAPTURE_FAILED", capturedPaise: 0, releasedPaise: 0 });
    expect(await status("VJW-BNZ-01", 1)).toBe("Available");
  });

  it("checks the amount", async () => {
    const token = await login(app);
    await block(token, "VJW-BNZ-01", 1, 5_000).expect(400);
    await block(token, "VJW-BNZ-01", 1, 2_000_000).expect(400);
    await block(token, "HYD-LBN-01", 1, 50_000).expect(409);
  });
});
