import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { GatewayClient } from "../src/stations/gateway-client";
import { checkChargerPassword, hashChargerPassword, newChargerPassword } from "../src/stations/ocpp-password";
import { createApp, db } from "./helpers";

const ADMIN = { "x-admin-key": "dev-admin-key" };
const GW = { "x-gateway-key": "dev-gateway-key" };

describe("charger passwords", () => {
  it("hash, check and reject", () => {
    const p = newChargerPassword();
    expect(p).toMatch(/^[A-Za-z0-9]{20}$/);
    const h = hashChargerPassword(p);
    expect(h.startsWith("scrypt:")).toBe(true);
    expect(checkChargerPassword(p, h)).toBe(true);
    expect(checkChargerPassword(p + "x", h)).toBe(false);
    expect(checkChargerPassword(p, null)).toBe(false);
  });
});

describe("Operator console: stations and chargers", () => {
  let app: INestApplication;
  const calls: { chargePointId: string; action: string; payload: Record<string, unknown> }[] = [];
  const cp = `TST-${Date.now().toString(36).toUpperCase()}`;
  let siteId: string;
  let password: string;

  beforeAll(async () => {
    app = await createApp();
    const gw = app.get(GatewayClient);
    gw.call = async (chargePointId, action, payload) => {
      calls.push({ chargePointId, action, payload });
      return { status: "Accepted" };
    };
  });
  afterAll(async () => {
    // Leave the shared test database as the seed made it, so other suites see only seeded chargers.
    const d = db(app);
    const chargers = await d.charger.findMany({ where: { chargePointId: { startsWith: "TST-" } } });
    const sites = [...new Set(chargers.map((c) => c.siteId))];
    await d.connector.deleteMany({ where: { chargerId: { in: chargers.map((c) => c.id) } } });
    await d.charger.deleteMany({ where: { id: { in: chargers.map((c) => c.id) } } });
    const rows = await d.site.findMany({ where: { id: { in: sites } } });
    await d.site.deleteMany({ where: { id: { in: sites } } });
    await d.place.deleteMany({ where: { id: { in: rows.map((r) => r.placeId) } } });
    const orgs = await d.organisation.findMany({ where: { name: { startsWith: "Sun Charge TST-" } } });
    await d.tariff.deleteMany({ where: { orgId: { in: orgs.map((o) => o.id) } } });
    await d.organisation.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
    await app.close();
  });
  const http = () => app.getHttpServer();

  it("needs the admin key and the gateway key", async () => {
    await request(http()).get("/v1/admin/stations").expect(401);
    await request(http()).post("/v1/internal/ocpp/events").send({}).expect(401);
    await request(http()).post("/v1/internal/ocpp/auth").set(ADMIN).send({}).expect(401);
  });

  it("adds a station for a new third-party operator", async () => {
    const ops = await request(http()).get("/v1/admin/cpo-operators").set(ADMIN).expect(200);
    expect(ops.body.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(["org-evgo", "org-partner-cpo"]));
    await request(http()).post("/v1/admin/stations").set(ADMIN).send({ name: "X", city: "Y", lat: 51.5, lng: -0.1, orgId: "org-evgo" }).expect(400);
    const res = await request(http())
      .post("/v1/admin/stations")
      .set(ADMIN)
      .send({ name: "Guntur Bus Depot", city: "Guntur", lat: 16.3067, lng: 80.4365, newOperatorName: `Sun Charge ${cp}` })
      .expect(201);
    expect(res.body).toMatchObject({ name: "Guntur Bus Depot", city: "Guntur", operator: { name: `Sun Charge ${cp}` }, chargers: [] });
    siteId = res.body.id;
  });

  it("adds a charger with two plugs and gives its login once", async () => {
    const res = await request(http())
      .post(`/v1/admin/stations/${siteId}/chargers`)
      .set(ADMIN)
      .send({
        chargePointId: cp.toLowerCase(),
        vendor: "Exicom",
        connectors: [
          { type: "CCS2", powerKw: 120, pricePerKwhInr: 21, segments: ["4W", "BUS"] },
          { type: "TYPE2", powerKw: 22, pricePerKwhInr: 14.5 },
        ],
      })
      .expect(201);
    password = res.body.connection.password;
    expect(res.body.connection).toMatchObject({ chargePointId: cp, url: `ws://localhost:9000/ocpp/${cp}`, username: cp, securityProfile: 1 });
    const charger = res.body.station.chargers[0];
    expect(charger).toMatchObject({ chargePointId: cp, online: false, hasPassword: true });
    expect(charger.connectors).toEqual([
      expect.objectContaining({ id: 1, label: "CCS2", current: "DC", powerKw: 120, pricePerKwhInr: 21, segments: ["4W", "BUS"], status: "Unavailable" }),
      expect.objectContaining({ id: 2, label: "Type 2", current: "AC", powerKw: 22, pricePerKwhInr: 14.5, segments: ["4W"] }),
    ]);
    expect(JSON.stringify(charger)).not.toContain(password);
    const stored = await db(app).charger.findUnique({ where: { chargePointId: cp } });
    expect(stored?.ocppPasswordHash).not.toContain(password);

    // Same ID twice, bad ID, bad plug.
    await request(http()).post(`/v1/admin/stations/${siteId}/chargers`).set(ADMIN).send({ chargePointId: cp, connectors: [{ type: "CCS2", powerKw: 60, pricePerKwhInr: 18 }] }).expect(409);
    await request(http()).post(`/v1/admin/stations/${siteId}/chargers`).set(ADMIN).send({ chargePointId: "bad id!", connectors: [{ type: "CCS2", powerKw: 60, pricePerKwhInr: 18 }] }).expect(400);
    await request(http()).post(`/v1/admin/stations/${siteId}/chargers`).set(ADMIN).send({ chargePointId: `${cp}-B`, connectors: [{ type: "XYZ", powerKw: 60, pricePerKwhInr: 18 }] }).expect(400);
  });

  it("checks the charger's login for the gateway, and a new password replaces the old", async () => {
    const ok = await request(http()).post("/v1/internal/ocpp/auth").set(GW).send({ chargePointId: cp, password }).expect(200);
    expect(ok.body.accepted).toBe(true);
    const bad = await request(http()).post("/v1/internal/ocpp/auth").set(GW).send({ chargePointId: cp, password: "nope" }).expect(200);
    expect(bad.body.accepted).toBe(false);
    const rotated = await request(http()).post(`/v1/admin/chargers/${cp}/password`).set(ADMIN).expect(201);
    expect(rotated.body.password).not.toBe(password);
    expect((await request(http()).post("/v1/internal/ocpp/auth").set(GW).send({ chargePointId: cp, password })).body.accepted).toBe(false);
    password = rotated.body.password;
    expect((await request(http()).post("/v1/internal/ocpp/auth").set(GW).send({ chargePointId: cp, password })).body.accepted).toBe(true);
  });

  it("shows the charger online with live plug status, and offline when it drops", async () => {
    await request(http()).post(`/v1/admin/chargers/${cp}/actions`).set(ADMIN).send({ action: "reset" }).expect(503);
    const ev = (e: object) => request(http()).post("/v1/internal/ocpp/events").set(GW).send({ chargePointId: cp, ...e }).expect(200);
    await ev({ type: "charger.connected" });
    await ev({ type: "charger.booted", vendor: "Exicom", model: "Harbor 120", firmware: "2.4.1" });
    await ev({ type: "connector.status", connectorId: 1, status: "Available" });
    await ev({ type: "connector.status", connectorId: 2, status: "Preparing" });
    let st = (await request(http()).get(`/v1/admin/stations/${siteId}`).set(ADMIN).expect(200)).body.chargers[0];
    expect(st).toMatchObject({ online: true, model: "Harbor 120", firmware: "2.4.1" });
    expect(st.connectors.map((c: { status: string }) => c.status)).toEqual(["Available", "Preparing"]);

    await ev({ type: "charger.disconnected" });
    st = (await request(http()).get(`/v1/admin/stations/${siteId}`).set(ADMIN).expect(200)).body.chargers[0];
    expect(st.online).toBe(false);
    expect(st.connectors.map((c: { status: string }) => c.status)).toEqual(["Unavailable", "Unavailable"]);
    await ev({ type: "charger.connected" });
  });

  it("sends reset, unlock and remote start to the charger", async () => {
    const act = (body: object) => request(http()).post(`/v1/admin/chargers/${cp}/actions`).set(ADMIN).send(body);
    await act({ action: "reset", type: "Hard" }).expect(200);
    await act({ action: "unlock", connectorId: 2 }).expect(200);
    await act({ action: "start", connectorId: 1 }).expect(200);
    await act({ action: "stop", connectorId: 1 }).expect(200); // the gateway finds the transaction on the plug
    await act({ action: "explode" }).expect(400);
    expect(calls).toEqual([
      { chargePointId: cp, action: "Reset", payload: { type: "Hard" } },
      { chargePointId: cp, action: "UnlockConnector", payload: { connectorId: 2 } },
      { chargePointId: cp, action: "RemoteStartTransaction", payload: { connectorId: 1, idTag: "EVGO-OPS" } },
      { chargePointId: cp, action: "RemoteStopTransaction", payload: { connectorId: 1 } },
    ]);
  });

  it("makes one QR per plug", async () => {
    const qr = await request(http()).get(`/v1/admin/chargers/${cp}/qr`).set(ADMIN).expect(200);
    expect(qr.body).toMatchObject({ station: "Guntur Bus Depot", chargePointId: cp });
    expect(qr.body.codes).toEqual([
      expect.objectContaining({ connectorId: 1, payload: `EVGO:${cp}:1`, printedCode: `${cp}-1`, label: "CCS2 · DC · 120 kW" }),
      expect.objectContaining({ connectorId: 2, payload: `EVGO:${cp}:2`, label: "Type 2 · AC · 22 kW" }),
    ]);
  });
});
