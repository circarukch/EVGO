import { randomUUID } from "node:crypto";
import { IncomingMessage, createServer, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { ChargePointHandler, HandlerDeps } from "./handlers.js";
import { CALL, CALL_ERROR, CALL_RESULT, OcppError, parseFrame } from "./ocpp.js";

const SUBPROTOCOL = "ocpp1.6";

export interface GatewayOptions extends HandlerDeps {
  /** Return true if this charger may connect. Security Profile 2 checks the Basic auth password here. */
  checkAuth?: (chargePointId: string, req: IncomingMessage) => boolean | Promise<boolean>;
  callTimeoutMs?: number;
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
    this.http = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, connected: this.connectedChargers() }));
    });
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

  private onConnect(id: string, ws: WebSocket) {
    this.sockets.get(id)?.terminate(); // a reconnecting charger replaces its old socket
    this.sockets.set(id, ws);
    ws.on("close", () => {
      if (this.sockets.get(id) === ws) this.sockets.delete(id);
    });
    ws.on("message", (data) => void this.onMessage(id, ws, data.toString()));
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
