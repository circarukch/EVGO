import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { config } from "../config";

/** Sends OCPP commands to a charger through the gateway's control endpoint. */
@Injectable()
export class GatewayClient {
  async call(chargePointId: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${config.ocppGatewayUrl}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gateway-key": config.gatewayApiKey },
        body: JSON.stringify({ chargePointId, action, payload }),
      });
    } catch {
      throw new ServiceUnavailableException("The OCPP gateway is not reachable");
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409) throw new ConflictException(String(body.message));
    if (!res.ok) throw new ServiceUnavailableException(String(body.message ?? `Gateway error ${res.status}`));
    return body;
  }
}
