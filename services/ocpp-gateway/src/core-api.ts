import { IncomingMessage } from "node:http";
import { ChargerEvent, EventSink } from "./handlers.js";

/**
 * Link to the core API: it checks charger passwords and receives charger events.
 * Both calls carry the shared gateway key.
 */
export interface CoreApi {
  url: string; // e.g. http://localhost:3000/v1
  key: string;
}

/** The password from an OCPP Basic auth header, if its username is this charger's ID. */
export function basicAuthPassword(chargePointId: string, req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  // OCPP 1.6 security profile 1/2: username is the charge point identity.
  if (decoded.slice(0, colon) !== chargePointId) return null;
  return decoded.slice(colon + 1);
}

async function post(api: CoreApi, path: string, body: unknown) {
  const res = await fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-gateway-key": api.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Let a charger in only if the core API accepts its password. Fails closed if the API is down. */
export function coreApiAuth(api: CoreApi) {
  return async (chargePointId: string, req: IncomingMessage): Promise<boolean> => {
    const password = basicAuthPassword(chargePointId, req);
    if (password === null) return false;
    try {
      return (await post(api, "/internal/ocpp/auth", { chargePointId, password })).accepted === true;
    } catch (err) {
      console.error(`login check for ${chargePointId} failed:`, (err as Error).message);
      return false;
    }
  };
}

/** Sends each charger event to the core API. (A queue replaces this when there are many gateways.) */
export function coreApiEvents(api: CoreApi): EventSink {
  return {
    publish: async (e: ChargerEvent) => {
      await post(api, "/internal/ocpp/events", e);
    },
  };
}
