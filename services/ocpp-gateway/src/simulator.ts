// OCPP 1.6J charge point simulator for local development and end-to-end tests.
// It stays connected like a real charger: boots, reports its plugs, sends heartbeats,
// and obeys RemoteStartTransaction, RemoteStopTransaction, Reset and UnlockConnector.
//
// Usage:
//   pnpm simulate ws://localhost:9000/ocpp/GNT-HUB-03 --password <from the console> --connectors 2
//   pnpm simulate ws://localhost:9000/ocpp/SIM-001            (gateway without logins)
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = args.find((a) => /^wss?:\/\//.test(a)) ?? "ws://localhost:9000/ocpp/SIM-001";
const chargePointId = decodeURIComponent(url.split("/").filter(Boolean).pop()!);
const password = flag("password", process.env.CHARGER_PASSWORD);
const connectorCount = Number(flag("connectors", "1"));
const powerKw = Number(flag("kw", "60"));
const vendor = flag("vendor", "EVGO-Sim")!;
const model = flag("model", "DC-60")!;

let ws: WebSocket;
let heartbeat: NodeJS.Timeout | undefined;
let stopping = false;
const waiting = new Map<string, (p: any) => void>();
const meterWh = new Map<number, number>(); // per connector, keeps counting across sessions
const running = new Map<number, { transactionId: number; timer: NodeJS.Timeout }>(); // by connector

const log = (...m: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...m);
const now = () => new Date().toISOString();

function call(action: string, payload: Record<string, unknown>): Promise<any> {
  const id = randomUUID();
  ws.send(JSON.stringify([2, id, action, payload]));
  return new Promise((resolve) => waiting.set(id, resolve));
}

const status = (connectorId: number, s: string) => call("StatusNotification", { connectorId, errorCode: "NoError", status: s });

async function startCharging(connectorId: number, idTag: string) {
  await status(connectorId, "Preparing");
  const meterStart = meterWh.get(connectorId) ?? 0;
  const res = await call("StartTransaction", { connectorId, idTag, meterStart, timestamp: now() });
  if (res?.idTagInfo?.status !== "Accepted") {
    log(`card ${idTag} refused (${res?.idTagInfo?.status})`);
    await status(connectorId, "Available");
    return;
  }
  await status(connectorId, "Charging");
  // Every 10 s, add what powerKw delivers in a minute (a sped-up session, easier to watch).
  const timer = setInterval(() => {
    const wh = (meterWh.get(connectorId) ?? 0) + Math.round((powerKw * 1000) / 60);
    meterWh.set(connectorId, wh);
    void call("MeterValues", {
      connectorId,
      transactionId: res.transactionId,
      meterValue: [{ timestamp: now(), sampledValue: [{ value: String(wh), unit: "Wh", measurand: "Energy.Active.Import.Register" }] }],
    });
  }, 10_000);
  running.set(connectorId, { transactionId: res.transactionId, timer });
  log(`charging on plug ${connectorId}, transaction ${res.transactionId}`);
}

async function stopCharging(connectorId: number, reason: string) {
  const tx = running.get(connectorId);
  if (!tx) return;
  clearInterval(tx.timer);
  running.delete(connectorId);
  await call("StopTransaction", { transactionId: tx.transactionId, meterStop: meterWh.get(connectorId) ?? 0, timestamp: now(), reason });
  await status(connectorId, "Finishing");
  await status(connectorId, "Available");
  log(`stopped plug ${connectorId} (${reason})`);
}

/** A command from the central system. Answer first, then act, as a real charger does. */
function onCommand(uid: string, action: string, payload: any) {
  const answer = (body: Record<string, unknown>) => ws.send(JSON.stringify([3, uid, body]));
  log("command:", action, JSON.stringify(payload));
  switch (action) {
    case "RemoteStartTransaction": {
      const connectorId = Number(payload.connectorId ?? 1);
      const ok = connectorId >= 1 && connectorId <= connectorCount && !running.has(connectorId);
      answer({ status: ok ? "Accepted" : "Rejected" });
      if (ok) void startCharging(connectorId, String(payload.idTag));
      return;
    }
    case "RemoteStopTransaction": {
      const entry = [...running.entries()].find(([, t]) => t.transactionId === payload.transactionId);
      answer({ status: entry ? "Accepted" : "Rejected" });
      if (entry) void stopCharging(entry[0], "Remote");
      return;
    }
    case "UnlockConnector": {
      const connectorId = Number(payload.connectorId);
      answer({ status: connectorId >= 1 && connectorId <= connectorCount ? "Unlocked" : "NotSupported" });
      if (running.has(connectorId)) void stopCharging(connectorId, "UnlockCommand");
      return;
    }
    case "Reset":
      answer({ status: "Accepted" });
      void (async () => {
        for (const c of [...running.keys()]) await stopCharging(c, payload.type === "Hard" ? "HardReset" : "SoftReset");
        log("rebooting…");
        ws.close(); // reconnects and boots again below
      })();
      return;
    default:
      ws.send(JSON.stringify([4, uid, "NotImplemented", `${action} is not simulated`, {}]));
  }
}

function connect() {
  const headers: Record<string, string> = {};
  if (password) headers.authorization = `Basic ${Buffer.from(`${chargePointId}:${password}`).toString("base64")}`;
  ws = new WebSocket(url, "ocpp1.6", { headers });

  ws.on("unexpected-response", (_req, res) => {
    log(`gateway refused the connection (HTTP ${res.statusCode}). Check the charger ID and password.`);
    process.exit(1);
  });
  ws.on("error", (err) => log("connection error:", err.message));
  ws.on("message", (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame[0] === 3 || frame[0] === 4) {
      waiting.get(frame[1])?.(frame[0] === 3 ? frame[2] : { error: frame.slice(2) });
      waiting.delete(frame[1]);
    } else if (frame[0] === 2) onCommand(frame[1], frame[2], frame[3]);
  });
  ws.on("open", async () => {
    log(`connected to ${url}${password ? " with password" : ""}`);
    const boot = await call("BootNotification", { chargePointVendor: vendor, chargePointModel: model, firmwareVersion: "sim-1.0" });
    log("boot:", boot.status);
    for (let c = 1; c <= connectorCount; c++) await status(c, "Available");
    const every = Math.max(5, Math.min(Number(flag("heartbeat", String(boot.interval ?? 60))), 300));
    heartbeat = setInterval(() => void call("Heartbeat", {}), every * 1000);
  });
  ws.on("close", () => {
    clearInterval(heartbeat);
    for (const t of running.values()) clearInterval(t.timer);
    running.clear();
    if (stopping) return;
    log("disconnected, reconnecting in 3 s");
    setTimeout(connect, 3000);
  });
}

process.on("SIGINT", () => {
  stopping = true;
  ws?.close();
  setTimeout(() => process.exit(0), 200);
});

connect();
