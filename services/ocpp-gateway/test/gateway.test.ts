import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ChargerEvent } from "../src/handlers.js";
import { OcppGateway, chargePointIdFrom } from "../src/server.js";

let gateway: OcppGateway;
let port: number;
let events: ChargerEvent[];
let blocked: Set<string>;

beforeEach(async () => {
  events = [];
  blocked = new Set(["BLOCKED-TAG"]);
  gateway = new OcppGateway({
    events: { publish: (e) => void events.push(e) },
    authorizer: { authorize: async (_cp, tag) => (blocked.has(tag) ? "Blocked" : "Accepted") },
    checkAuth: (id) => id !== "ROGUE",
    callTimeoutMs: 2000,
  });
  port = await gateway.listen(0);
});

afterEach(async () => {
  await gateway.close();
});

function connect(id: string): Promise<{ ws: WebSocket; call: (action: string, payload: object) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ocpp/${id}`, "ocpp1.6");
    const waiting = new Map<string, (f: any) => void>();
    let n = 0;
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f[0] === 2) ws.send(JSON.stringify([3, f[1], { status: "Accepted", echo: f[2] }]));
      else waiting.get(f[1])?.(f);
    });
    ws.on("open", () =>
      resolve({
        ws,
        call: (action, payload) =>
          new Promise((r) => {
            const uid = `m${++n}`;
            waiting.set(uid, r);
            ws.send(JSON.stringify([2, uid, action, payload]));
          }),
      }),
    );
    ws.on("error", reject);
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

describe("chargePointIdFrom", () => {
  it("reads the id from the path", () => {
    expect(chargePointIdFrom("/ocpp/GNT-HUB-01")).toBe("GNT-HUB-01");
    expect(chargePointIdFrom("/ocpp/GNT-HUB-01?x=1")).toBe("GNT-HUB-01");
    expect(chargePointIdFrom("/other/GNT")).toBeNull();
  });
});

describe("OcppGateway", () => {
  it("runs a full charging session and reports energy used", async () => {
    const { ws, call } = await connect("CP-1");
    const boot = await call("BootNotification", { chargePointVendor: "Acme", chargePointModel: "DC60" });
    expect(boot[2].status).toBe("Accepted");

    const start = await call("StartTransaction", { connectorId: 1, idTag: "CARD-1", meterStart: 1000, timestamp: "2026-11-26T10:00:00Z" });
    expect(start[2].idTagInfo.status).toBe("Accepted");
    const txId = start[2].transactionId;

    await call("MeterValues", { connectorId: 1, transactionId: txId, meterValue: [{ timestamp: "2026-11-26T10:05:00Z", sampledValue: [{ value: "3500" }] }] });
    const stop = await call("StopTransaction", { transactionId: txId, meterStop: 8500, timestamp: "2026-11-26T10:30:00Z" });
    expect(stop[2].idTagInfo.status).toBe("Accepted");

    const stopped = events.find((e) => e.type === "session.stopped");
    expect(stopped).toMatchObject({ chargePointId: "CP-1", transactionId: txId, energyWh: 7500 });
    expect(events.map((e) => e.type)).toEqual(["charger.booted", "session.started", "session.meter", "session.stopped"]);
    ws.close();
  });

  it("rejects a blocked card without starting a session", async () => {
    const { ws, call } = await connect("CP-2");
    const start = await call("StartTransaction", { connectorId: 1, idTag: "BLOCKED-TAG", meterStart: 0, timestamp: "2026-11-26T10:00:00Z" });
    expect(start[2].idTagInfo.status).toBe("Blocked");
    expect(events.some((e) => e.type === "session.started")).toBe(false);
    ws.close();
  });

  it("answers unknown actions with NotImplemented", async () => {
    const { ws, call } = await connect("CP-3");
    const res = await call("SomethingNew", {});
    expect(res[0]).toBe(4);
    expect(res[2]).toBe("NotImplemented");
    ws.close();
  });

  it("refuses chargers that fail the auth check", async () => {
    await expect(connect("ROGUE")).rejects.toThrow("401");
  });

  it("sends remote commands to a connected charger", async () => {
    const { ws } = await connect("CP-4");
    await new Promise((r) => setTimeout(r, 20));
    const res = await gateway.sendCall("CP-4", "RemoteStartTransaction", { idTag: "APP-USER-1", connectorId: 1 });
    expect(res).toMatchObject({ status: "Accepted", echo: "RemoteStartTransaction" });
    await expect(gateway.sendCall("NOPE", "Reset", { type: "Soft" })).rejects.toThrow("not connected");
    ws.close();
  });
});
