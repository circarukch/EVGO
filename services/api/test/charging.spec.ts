import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { CHARGER_CONTROL, SimulatedChargerControl } from "../src/charging/charger-control";
import { createApp, login, topUp } from "./helpers";

describe("Charging from the app", () => {
  let app: INestApplication;
  let sim: SimulatedChargerControl;
  beforeAll(async () => {
    app = await createApp();
    sim = app.get(CHARGER_CONTROL);
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const status = async (cp: string, id: number) =>
    (await request(http()).get(`/v1/chargers/${cp}`).expect(200)).body.connectors.find((c: { id: number }) => c.id === id).status;

  it("needs ₹100 in the wallet to start", async () => {
    const token = await login(app);
    const res = await request(http()).post("/v1/charging/sessions").set(as(token)).send({ chargePointId: "VJW-BNZ-01", connectorId: 1 });
    expect(res.status).toBe(402);
    expect(res.body.shortfallPaise).toBe(10_000);
  });

  it("starts, meters live, stops and bills energy × tariff from the wallet", async () => {
    const token = await login(app);
    await topUp(app, token, 100_000);
    const started = await request(http()).post("/v1/charging/sessions").set(as(token)).send({ chargePointId: "VJW-BNZ-01", connectorId: 1 }).expect(201);
    expect(started.body).toMatchObject({ status: "ACTIVE", placeName: "Vijayawada Benz Circle", perKwhInr: 18, connectorType: "CCS2" });
    expect(await status("VJW-BNZ-01", 1)).toBe("Charging");

    const other = await login(app);
    await topUp(app, other, 20_000);
    const busy = await request(http()).post("/v1/charging/sessions").set(as(other)).send({ chargePointId: "VJW-BNZ-01", connectorId: 1 });
    expect(busy.status).toBe(409);
    expect(busy.body.message).toBe("This connector is busy");
    await request(http()).post("/v1/charging/sessions").set(as(token)).send({ chargePointId: "VJW-BNZ-01", connectorId: 2 }).expect(409);

    sim.advance(30 * 60_000); // 30 minutes at 85% of 60 kW = 25.5 kWh
    const live = (await request(http()).get("/v1/charging/sessions/active").set(as(token)).expect(200)).body.session;
    expect(live.energyKwh).toBeCloseTo(25.5, 1);
    expect(live.powerKw).toBeCloseTo(51, 1);
    expect(live.costPaise).toBe(Math.ceil(live.energyKwh * 1800));

    const stopped = await request(http()).post(`/v1/charging/sessions/${started.body.id}/stop`).set(as(token)).expect(201);
    expect(stopped.body.status).toBe("STOPPED");
    expect(stopped.body.balancePaise).toBe(100_000 - stopped.body.costPaise);
    expect(await status("VJW-BNZ-01", 1)).toBe("Available");
    await request(http()).post(`/v1/charging/sessions/${started.body.id}/stop`).set(as(token)).expect(409);
    expect((await request(http()).get("/v1/charging/sessions/active").set(as(token)).expect(200)).body.session).toBeNull();
    await request(http()).get(`/v1/charging/sessions/${started.body.id}`).set(as(other)).expect(403);
  });

  it("stops by itself when the session has used the wallet balance", async () => {
    const token = await login(app);
    await topUp(app, token, 10_000);
    const started = await request(http()).post("/v1/charging/sessions").set(as(token)).send({ chargePointId: "GNT-HUB-01", connectorId: 1 }).expect(201);
    sim.advance(60 * 60_000);
    const view = await request(http()).get(`/v1/charging/sessions/${started.body.id}`).set(as(token)).expect(200);
    expect(view.body).toMatchObject({ status: "STOPPED", stopReason: "WalletLimit", costPaise: 10_000, balancePaise: 0 });
  });

  it("refuses faulted, fleet-only and unknown chargers", async () => {
    const token = await login(app);
    await topUp(app, token, 20_000);
    const start = (chargePointId: string, connectorId: number) =>
      request(http()).post("/v1/charging/sessions").set(as(token)).send({ chargePointId, connectorId });
    const faulted = await start("HYD-LBN-01", 1);
    expect(faulted.status).toBe(409);
    expect(faulted.body.message).toBe("This connector is out of service");
    await start("GNT-DEPOT-01", 1).expect(403);
    await start("NOPE-01", 1).expect(404);
  });
});
