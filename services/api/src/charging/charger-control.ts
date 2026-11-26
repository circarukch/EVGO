/**
 * How the API tells a charger to start and stop, and reads its meter. Production talks to chargers
 * through the OCPP gateway (RemoteStartTransaction / MeterValues / RemoteStopTransaction); until that
 * link is wired, the simulated control below stands in for development, tests and the demo.
 */
export interface ChargerControl {
  start(req: { chargePointId: string; connectorId: number; idTag: string; maxPowerKw: number }): Promise<{ transactionId: number; meterStartWh: number }>;
  /** Current energy register (Wh) and the power being delivered now (kW). */
  meter(chargePointId: string, transactionId: number): Promise<{ meterWh: number; powerKw: number }>;
  stop(chargePointId: string, transactionId: number): Promise<{ meterStopWh: number }>;
}

export const CHARGER_CONTROL = Symbol("ChargerControl");

interface SimTx {
  startedAt: number;
  meterStartWh: number;
  powerKw: number;
  stoppedWh?: number;
}

/**
 * A pretend charger: delivers 85% of the connector's rated power from the moment it starts.
 * `speedup` makes demo sessions move faster than real time (30 = one real minute is 30 charging minutes).
 */
export class SimulatedChargerControl implements ChargerControl {
  // Real chargers never reuse a transaction id; start from the clock so a restarted simulator does not either.
  private nextTx = Date.now() % 2_000_000_000;
  private started = 0;
  private readonly tx = new Map<string, SimTx>();
  private offsetMs = 0;

  constructor(private readonly speedup = 1) {}

  private now() {
    return Date.now() + this.offsetMs;
  }

  /** Tests: move the simulated clock forward. */
  advance(ms: number) {
    this.offsetMs += ms;
  }

  private key = (cp: string, id: number) => `${cp}#${id}`;

  async start(req: { chargePointId: string; connectorId: number; maxPowerKw: number }) {
    const transactionId = this.nextTx++;
    const meterStartWh = 1_000_000 + ++this.started * 10_000;
    this.tx.set(this.key(req.chargePointId, transactionId), { startedAt: this.now(), meterStartWh, powerKw: req.maxPowerKw * 0.85 });
    return { transactionId, meterStartWh };
  }

  private reading(t: SimTx) {
    if (t.stoppedWh !== undefined) return t.stoppedWh;
    const hours = ((this.now() - t.startedAt) / 3_600_000) * this.speedup;
    return Math.floor(t.meterStartWh + hours * t.powerKw * 1000);
  }

  async meter(chargePointId: string, transactionId: number) {
    const t = this.tx.get(this.key(chargePointId, transactionId));
    if (!t) throw new Error("Unknown transaction");
    return { meterWh: this.reading(t), powerKw: t.stoppedWh === undefined ? t.powerKw : 0 };
  }

  async stop(chargePointId: string, transactionId: number) {
    const t = this.tx.get(this.key(chargePointId, transactionId));
    if (!t) throw new Error("Unknown transaction");
    t.stoppedWh = this.reading(t);
    return { meterStopWh: t.stoppedWh };
  }
}

/** Used in production until the OCPP gateway link is built: app charging is refused, clearly. */
export class NotConnectedChargerControl implements ChargerControl {
  private fail(): never {
    throw new Error("NOT_CONNECTED");
  }
  async start(): Promise<{ transactionId: number; meterStartWh: number }> {
    this.fail();
  }
  async meter(): Promise<{ meterWh: number; powerKw: number }> {
    this.fail();
  }
  async stop(): Promise<{ meterStopWh: number }> {
    this.fail();
  }
}
