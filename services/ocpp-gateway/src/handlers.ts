import {
  AuthorizeReq,
  BootNotificationReq,
  IdTagStatus,
  MeterValuesReq,
  OcppError,
  StartTransactionReq,
  StatusNotificationReq,
  StopTransactionReq,
} from "./ocpp.js";

/** Events the gateway hands to the core backend (via the event queue in production). */
export type ChargerEvent =
  | { type: "charger.connected"; chargePointId: string }
  | { type: "charger.disconnected"; chargePointId: string }
  | { type: "charger.heartbeat"; chargePointId: string }
  | { type: "charger.booted"; chargePointId: string; vendor: string; model: string; firmware?: string }
  | { type: "connector.status"; chargePointId: string; connectorId: number; status: string; errorCode: string }
  | { type: "session.started"; chargePointId: string; connectorId: number; transactionId: number; idTag: string; meterStartWh: number; at: string }
  | { type: "session.meter"; chargePointId: string; transactionId?: number; values: Array<{ measurand: string; value: number; unit?: string; at: string }> }
  | { type: "session.stopped"; chargePointId: string; transactionId: number; meterStopWh: number; energyWh: number; reason?: string; at: string };

export interface EventSink {
  publish(event: ChargerEvent): void | Promise<void>;
}

/** Decides whether an RFID card or app token may charge. Backed by the core API in production. */
export interface Authorizer {
  authorize(chargePointId: string, idTag: string): Promise<IdTagStatus>;
}

interface OpenTx {
  chargePointId: string;
  connectorId: number;
  idTag: string;
  meterStartWh: number;
}

export interface HandlerDeps {
  events: EventSink;
  authorizer: Authorizer;
  heartbeatIntervalSec?: number;
  now?: () => Date;
}

/** Handles CALLs from a charge point and returns the CALLRESULT payload. */
export class ChargePointHandler {
  private nextTxId = 1;
  private readonly openTx = new Map<number, OpenTx>();

  constructor(private readonly deps: HandlerDeps) {}

  /** The transaction running on a plug, as this gateway saw it start. */
  openTransaction(chargePointId: string, connectorId: number): number | null {
    for (const [id, tx] of this.openTx) if (tx.chargePointId === chargePointId && tx.connectorId === connectorId) return id;
    return null;
  }

  private now(): string {
    return (this.deps.now ? this.deps.now() : new Date()).toISOString();
  }

  async handle(chargePointId: string, action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (action) {
      case "BootNotification":
        return this.boot(chargePointId, payload as unknown as BootNotificationReq);
      case "Heartbeat":
        await this.deps.events.publish({ type: "charger.heartbeat", chargePointId });
        return { currentTime: this.now() };
      case "StatusNotification":
        return this.status(chargePointId, payload as unknown as StatusNotificationReq);
      case "Authorize":
        return { idTagInfo: { status: await this.deps.authorizer.authorize(chargePointId, (payload as unknown as AuthorizeReq).idTag) } };
      case "StartTransaction":
        return this.start(chargePointId, payload as unknown as StartTransactionReq);
      case "MeterValues":
        return this.meter(chargePointId, payload as unknown as MeterValuesReq);
      case "StopTransaction":
        return this.stop(chargePointId, payload as unknown as StopTransactionReq);
      case "DataTransfer":
        return { status: "UnknownVendorId" };
      default:
        throw new OcppError("NotImplemented", `Action ${action} is not implemented`);
    }
  }

  private async boot(cp: string, req: BootNotificationReq) {
    if (!req.chargePointVendor || !req.chargePointModel) {
      throw new OcppError("OccurrenceConstraintViolation", "chargePointVendor and chargePointModel are required");
    }
    await this.deps.events.publish({
      type: "charger.booted",
      chargePointId: cp,
      vendor: req.chargePointVendor,
      model: req.chargePointModel,
      firmware: req.firmwareVersion,
    });
    return { status: "Accepted", currentTime: this.now(), interval: this.deps.heartbeatIntervalSec ?? 300 };
  }

  private async status(cp: string, req: StatusNotificationReq) {
    if (typeof req.connectorId !== "number" || !req.status) {
      throw new OcppError("OccurrenceConstraintViolation", "connectorId and status are required");
    }
    await this.deps.events.publish({
      type: "connector.status",
      chargePointId: cp,
      connectorId: req.connectorId,
      status: req.status,
      errorCode: req.errorCode,
    });
    return {};
  }

  private async start(cp: string, req: StartTransactionReq) {
    const status = await this.deps.authorizer.authorize(cp, req.idTag);
    const transactionId = this.nextTxId++;
    if (status === "Accepted") {
      this.openTx.set(transactionId, { chargePointId: cp, connectorId: req.connectorId, idTag: req.idTag, meterStartWh: req.meterStart });
      await this.deps.events.publish({
        type: "session.started",
        chargePointId: cp,
        connectorId: req.connectorId,
        transactionId,
        idTag: req.idTag,
        meterStartWh: req.meterStart,
        at: req.timestamp,
      });
    }
    return { transactionId, idTagInfo: { status } };
  }

  private async meter(cp: string, req: MeterValuesReq) {
    const values = (req.meterValue ?? []).flatMap((mv) =>
      mv.sampledValue.map((sv) => ({
        measurand: sv.measurand ?? "Energy.Active.Import.Register",
        value: Number(sv.value),
        unit: sv.unit,
        at: mv.timestamp,
      })),
    );
    await this.deps.events.publish({ type: "session.meter", chargePointId: cp, transactionId: req.transactionId, values });
    return {};
  }

  private async stop(cp: string, req: StopTransactionReq) {
    const tx = this.openTx.get(req.transactionId);
    // A charger that was offline may stop a transaction we never saw start; bill from what it reports.
    const meterStartWh = tx?.meterStartWh ?? req.meterStop;
    this.openTx.delete(req.transactionId);
    await this.deps.events.publish({
      type: "session.stopped",
      chargePointId: cp,
      transactionId: req.transactionId,
      meterStopWh: req.meterStop,
      energyWh: Math.max(0, req.meterStop - meterStartWh),
      reason: req.reason,
      at: req.timestamp,
    });
    return { idTagInfo: { status: "Accepted" } };
  }
}
