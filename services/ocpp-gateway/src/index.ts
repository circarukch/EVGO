import { coreApiAuth, coreApiEvents } from "./core-api.js";
import { OcppGateway } from "./server.js";

const port = Number(process.env.PORT ?? 9000);
const apiUrl = process.env.CORE_API_URL; // e.g. http://localhost:3000/v1
const key = process.env.GATEWAY_API_KEY ?? (process.env.NODE_ENV === "production" ? undefined : "dev-gateway-key");
if (apiUrl && !key) throw new Error("GATEWAY_API_KEY is required");

// With CORE_API_URL: chargers log in with their console-issued password, and events go to the API.
// Without it (quick local runs): every charger is let in and events are only logged.
const api = apiUrl && key ? { url: apiUrl.replace(/\/$/, ""), key } : null;
const gateway = new OcppGateway({
  events: api ? coreApiEvents(api) : { publish: (e) => console.log(JSON.stringify(e)) },
  checkAuth: api ? coreApiAuth(api) : undefined,
  authorizer: { authorize: async () => "Accepted" },
  heartbeatIntervalSec: Number(process.env.HEARTBEAT_INTERVAL_SEC ?? 300),
  controlKey: key,
});

gateway.listen(port).then((p) => {
  console.log(`OCPP gateway listening on ws://localhost:${p}/ocpp/<chargePointId>`);
  console.log(api ? `Charger logins and events go to ${api.url}` : "No CORE_API_URL: accepting all chargers, logging events");
});
