import { randomUUID, timingSafeEqual } from "node:crypto";
import { IncomingMessage, createServer, Server, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { ChargePointHandler, ChargerEvent, HandlerDeps } from "./handlers.js";
import { CALL, CALL_ERROR, CALL_RESULT, OcppError, parseFrame } from "./ocpp.js";

const SUBPROTOCOL = "ocpp1.6";
/** Commands the core API may send through POST /commands. */
const COMMANDS = new Set(["RemoteStartTransaction", "RemoteStopTransaction", "Reset", "UnlockConnector", "TriggerMessage", "ChangeAvailability"]);

export interface GatewayOptions extends HandlerDeps {
  /** Return true if this charger may connect. Security Profile 2 checks the Basic auth password here. */
  checkAuth?: (chargePointId: string, req: IncomingMessage) => boolean | Promise<boolean>;
  callTimeoutMs?: number;
  /** Key the core API sends to POST /commands. Without it the command endpoint is off. */
  controlKey?: string;
}

interface Pending {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** WebSocket server that chargers connect to at ws(s)://host/ocpp/<chargePointId>. */
export class OcppGateway {
  readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly handler: ChargePointHandler;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly opts: GatewayOptions) {
    this.handler = new ChargePointHandler(opts);
    this.http = createServer((req, res) => void this.onHttp(req, res));
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
    });
    this.http.on("upgrade", async (req, socket, head) => {
      const id = chargePointIdFrom(req.url);
      const allowed = id !== null && (this.opts.checkAuth ? await this.opts.checkAuth(id, req) : true);
      if (!allowed || id === null) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(id, ws));
    });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => {
        const addr = this.http.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  async close(): Promise<void> {
    for (const ws of this.sockets.values()) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  connectedChargers(): string[] {
    return [...this.sockets.keys()];
  }

  /** Send a command to a charger (RemoteStartTransaction, RemoteStopTransaction, Reset, ...). */
  sendCall(chargePointId: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ws = this.sockets.get(chargePointId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Charger ${chargePointId} is not connected`));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${action} to ${chargePointId} timed out`));
      }, this.opts.callTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify([CALL, id, action, payload]));
    });
  }

  /** GET: health. POST /commands: the core API sends a command to a charger and gets its answer. */
  private async onHttp(req: IncomingMessage, res: ServerResponse) {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/commands") {
      return reply(200, { ok: true, connected: this.connectedChargers() });
    }
    if (!this.opts.controlKey || !sameKey(String(req.headers["x-gateway-key"] ?? ""), this.opts.controlKey)) {
      return reply(401, { message: "Gateway key required" });
    }
    let body: { chargePointId?: string; action?: string; payload?: Record<string, unknown> };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return reply(400, { message: "Body must be JSON" });
    }
    if (!body.chargePointId || !body.action || !COMMANDS.has(body.action)) return reply(400, { message: "chargePointId and a known action are required" });
    let payload = body.payload ?? {};
    // The API may ask to stop "whatever runs on plug N": fill in the transaction this gateway saw start.
    if (body.action === "RemoteStopTransaction" && payload.transactionId === undefined && typeof payload.connectorId === "number") {
      const transactionId = this.handler.openTransaction(body.chargePointId, payload.connectorId);
      if (transactionId === null) return reply(409, { message: `Nothing is charging on plug ${payload.connectorId}` });
      payload = { transactionId };
    }
    try {
      reply(200, await this.sendCall(body.chargePointId, body.action, payload));
    } catch (err) {
      reply(502, { message: (err as Error).message });
    }
  }

  private onConnect(id: string, ws: WebSocket) {
    this.sockets.get(id)?.terminate(); // a reconnecting charger replaces its old socket
    this.sockets.set(id, ws);
    void this.publish({ type: "charger.connected", chargePointId: id });
    ws.on("close", () => {
      if (this.sockets.get(id) !== ws) return; // replaced by a newer connection: still online
      this.sockets.delete(id);
      void this.publish({ type: "charger.disconnected", chargePointId: id });
    });
    ws.on("message", (data) => void this.onMessage(id, ws, data.toString()));
  }

  private async publish(e: ChargerEvent) {
    try {
      await this.opts.events.publish(e);
    } catch (err) {
      console.error(`event ${e.type} for ${e.chargePointId} not delivered:`, (err as Error).message);
    }
  }

  private async onMessage(id: string, ws: WebSocket, raw: string) {
    let frame;
    try {
      frame = parseFrame(raw);
    } catch (err) {
      const e = err as OcppError;
      ws.send(JSON.stringify([CALL_ERROR, "-1", e.code ?? "FormationViolation", e.message, {}]));
      return;
    }
    if (frame[0] === CALL) {
      const [, uid, action, payload] = frame;
      try {
        const result = await this.handler.handle(id, action, payload);
        ws.send(JSON.stringify([CALL_RESULT, uid, result]));
      } catch (err) {
        const code = err instanceof OcppError ? err.code : "InternalError";
        ws.send(JSON.stringify([CALL_ERROR, uid, code, (err as Error).message, {}]));
      }
      return;
    }
    const pending = this.pending.get(frame[1]);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame[1]);
    if (frame[0] === CALL_RESULT) pending.resolve(frame[2]);
    else pending.reject(new Error(`${frame[2]}: ${frame[3]}`));
  }
}

export function chargePointIdFrom(url: string | undefined): string | null {
  const match = /^\/ocpp\/([A-Za-z0-9._-]{1,48})\/?$/.exec((url ?? "").split("?")[0]);
  return match ? decodeURIComponent(match[1]) : null;
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
