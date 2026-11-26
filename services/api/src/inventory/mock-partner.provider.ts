import { randomBytes } from "node:crypto";
import { istDate, istInstant } from "../common/time";
import {
  BlockRequest,
  BlockResult,
  BusInventoryProvider,
  CancelResult,
  ConfirmResult,
  ProviderError,
  ProviderSeatMap,
  ProviderTrip,
} from "./provider";

interface MockTrip {
  ref: string;
  operator: string;
  busType: string;
  departsAt: Date;
  arrivesAt: Date;
  farePaise: number;
  seats: Map<string, { status: "available" | "held" | "booked"; blockKey?: string; pnr?: string }>;
}

interface MockBlock {
  tripRef: string;
  seatLabels: string[];
  expiresAt: Date;
  pnr?: string;
}

const HOLD_MINUTES = 10;
const DAYS_AHEAD = 7;
const SERVICES = [
  { code: "SKT2100", operator: "Partner Travels (demo)", busType: "AC sleeper (partner)", depart: "21:00", hours: 6, farePaise: 89_900, seats: 30 },
  { code: "GRN2230", operator: "Green Line Coaches (demo)", busType: "AC seater (partner)", depart: "22:30", hours: 6.5, farePaise: 64_900, seats: 36 },
];

/**
 * A pretend outside bus company, so the whole partner flow can be built and tested before a vendor
 * is chosen. Guntur to Hyderabad only, two night services a day for a week. In-memory, so it resets
 * on restart. Its cancellation rules deliberately differ from EVGO's (100% at 48h+, 75% at 12h+).
 */
export class MockPartnerProvider implements BusInventoryProvider {
  readonly id = "mock-partner";
  readonly displayName = "Mock partner bus API";

  private trips = new Map<string, MockTrip>();
  private blocks = new Map<string, MockBlock>();
  /** Test hook: make the next confirm fail as a real vendor sometimes does. */
  failNextConfirm = false;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private ensureTrips() {
    for (let day = 0; day < DAYS_AHEAD; day++) {
      const date = istDate(day, this.now());
      for (const s of SERVICES) {
        const ref = `${s.code}-${date}`;
        if (this.trips.has(ref)) continue;
        const departsAt = istInstant(date, s.depart);
        const seats = new Map<string, { status: "available" | "held" | "booked" }>();
        for (let i = 1; i <= s.seats; i++) seats.set(`P${i}`, { status: "available" });
        this.trips.set(ref, {
          ref,
          operator: s.operator,
          busType: s.busType,
          departsAt,
          arrivesAt: new Date(departsAt.getTime() + s.hours * 3_600_000),
          farePaise: s.farePaise,
          seats,
        });
      }
    }
  }

  /** Lapsed blocks give their seats back. */
  private expireBlocks() {
    const now = this.now();
    for (const [key, b] of this.blocks) {
      if (b.pnr || b.expiresAt > now) continue;
      const trip = this.trips.get(b.tripRef);
      for (const label of b.seatLabels) {
        const seat = trip?.seats.get(label);
        if (seat?.status === "held" && seat.blockKey === key) trip!.seats.set(label, { status: "available" });
      }
      this.blocks.delete(key);
    }
  }

  private trip(ref: string): MockTrip {
    this.ensureTrips();
    this.expireBlocks();
    const t = this.trips.get(ref);
    if (!t) throw new ProviderError("not_found", "Trip not found");
    return t;
  }

  async searchTrips(fromCity: string, toCity: string): Promise<ProviderTrip[]> {
    if (fromCity.toLowerCase() !== "guntur" || toCity.toLowerCase() !== "hyderabad") return [];
    this.ensureTrips();
    this.expireBlocks();
    const now = this.now();
    return [...this.trips.values()]
      .filter((t) => t.departsAt > now)
      .map((t) => ({
        ref: t.ref,
        operator: t.operator,
        from: "Guntur Bus Stand",
        to: "Hyderabad MGBS",
        departsAt: t.departsAt,
        arrivesAt: t.arrivesAt,
        busType: t.busType,
        seatsLeft: [...t.seats.values()].filter((s) => s.status === "available").length,
        minFarePaise: t.farePaise,
        electric: false,
      }));
  }

  async seatMap(ref: string): Promise<ProviderSeatMap> {
    const t = this.trip(ref);
    return {
      operator: t.operator,
      routeName: "Guntur to Hyderabad",
      departsAt: t.departsAt,
      seats: [...t.seats.entries()].map(([seatLabel, s]) => ({ seatLabel, farePaise: t.farePaise, status: s.status })),
      cancellationPolicy: [
        { minHoursBefore: 48, refundPercent: 100 },
        { minHoursBefore: 12, refundPercent: 75 },
      ],
    };
  }

  async block(req: BlockRequest): Promise<BlockResult> {
    const t = this.trip(req.tripRef);
    if (t.departsAt <= this.now()) throw new ProviderError("seat_unavailable", "This trip is no longer open for booking");
    for (const s of req.seats) {
      if (t.seats.get(s.seatLabel)?.status !== "available") throw new ProviderError("seat_unavailable", `Seat ${s.seatLabel} is not available`);
    }
    const blockKey = `BLK${randomBytes(6).toString("hex").toUpperCase()}`;
    const expiresAt = new Date(this.now().getTime() + HOLD_MINUTES * 60_000);
    for (const s of req.seats) t.seats.set(s.seatLabel, { status: "held", blockKey });
    this.blocks.set(blockKey, { tripRef: t.ref, seatLabels: req.seats.map((s) => s.seatLabel), expiresAt });
    return { blockKey, expiresAt, seats: req.seats.map((s) => ({ seatLabel: s.seatLabel, farePaise: t.farePaise })) };
  }

  async confirm(blockKey: string): Promise<ConfirmResult> {
    this.expireBlocks();
    const b = this.blocks.get(blockKey);
    if (!b || b.pnr) throw new ProviderError("block_expired", "Seat hold expired. Choose seats again");
    if (this.failNextConfirm) {
      this.failNextConfirm = false;
      throw new ProviderError("unavailable", "Partner system did not respond");
    }
    const t = this.trips.get(b.tripRef)!;
    b.pnr = `PNR${randomBytes(4).toString("hex").toUpperCase()}`;
    for (const label of b.seatLabels) t.seats.set(label, { status: "booked", pnr: b.pnr });
    return { pnr: b.pnr, tickets: b.seatLabels.map((seatLabel, i) => ({ seatLabel, ticketNo: `${b.pnr}-${i + 1}` })) };
  }

  async release(blockKey: string): Promise<void> {
    const b = this.blocks.get(blockKey);
    if (!b || b.pnr) return;
    const t = this.trips.get(b.tripRef);
    for (const label of b.seatLabels) t?.seats.set(label, { status: "available" });
    this.blocks.delete(blockKey);
  }

  async cancel(pnr: string, seatLabels: string[]): Promise<CancelResult> {
    const b = [...this.blocks.values()].find((x) => x.pnr === pnr);
    if (!b) throw new ProviderError("not_found", "Booking not found with the bus company");
    const t = this.trips.get(b.tripRef)!;
    const hours = (t.departsAt.getTime() - this.now().getTime()) / 3_600_000;
    const percent = hours >= 48 ? 100 : hours >= 12 ? 75 : null;
    if (percent === null) throw new ProviderError("not_cancellable", "The bus company closes cancellation 12 hours before departure");
    let refundPaise = 0;
    for (const label of seatLabels) {
      const seat = t.seats.get(label);
      if (seat?.status !== "booked" || seat.pnr !== pnr) continue;
      t.seats.set(label, { status: "available" });
      refundPaise += Math.floor((t.farePaise * percent) / 100);
    }
    return { refundPaise };
  }
}
