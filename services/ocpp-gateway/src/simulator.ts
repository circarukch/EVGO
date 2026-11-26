// Minimal OCPP 1.6J charge point simulator for local development.
// Usage: pnpm simulate [ws://localhost:9000/ocpp/SIM-001]
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

const url = process.argv[2] ?? "ws://localhost:9000/ocpp/SIM-001";
const ws = new WebSocket(url, "ocpp1.6");
const waiting = new Map<string, (p: any) => void>();

function call(action: string, payload: Record<string, unknown>): Promise<any> {
  const id = randomUUID();
  ws.send(JSON.stringify([2, id, action, payload]));
  return new Promise((resolve) => waiting.set(id, resolve));
}

ws.on("message", (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame[0] === 3 || frame[0] === 4) {
    waiting.get(frame[1])?.(frame[0] === 3 ? frame[2] : { error: frame.slice(2) });
    waiting.delete(frame[1]);
  } else if (frame[0] === 2) {
    console.log("command from gateway:", frame[2], frame[3]);
    ws.send(JSON.stringify([3, frame[1], { status: "Accepted" }]));
  }
});

ws.on("open", async () => {
  const now = () => new Date().toISOString();
  console.log("boot", await call("BootNotification", { chargePointVendor: "EVGO-Sim", chargePointModel: "DC-60" }));
  await call("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available" });
  const start = await call("StartTransaction", { connectorId: 1, idTag: "DEMO-RFID", meterStart: 10_000, timestamp: now() });
  console.log("start", start);
  await call("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Charging" });
  for (let wh = 12_000; wh <= 16_000; wh += 2_000) {
    await call("MeterValues", {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [{ timestamp: now(), sampledValue: [{ value: String(wh), unit: "Wh" }] }],
    });
  }
  console.log("stop", await call("StopTransaction", { transactionId: start.transactionId, meterStop: 16_000, timestamp: now() }));
  await call("StatusNotification", { connectorId: 1, errorCode: "NoError", status: "Available" });
  ws.close();
});
