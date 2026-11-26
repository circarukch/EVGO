import { OcppGateway } from "./server.js";

const port = Number(process.env.PORT ?? 9000);

// MVP wiring: log events and accept every idTag. Production replaces these with
// the event queue publisher and a call to the core API's authorisation endpoint.
const gateway = new OcppGateway({
  events: { publish: (e) => console.log(JSON.stringify(e)) },
  authorizer: { authorize: async () => "Accepted" },
  heartbeatIntervalSec: Number(process.env.HEARTBEAT_INTERVAL_SEC ?? 300),
});

gateway.listen(port).then((p) => console.log(`OCPP gateway listening on ws://localhost:${p}/ocpp/<chargePointId>`));
