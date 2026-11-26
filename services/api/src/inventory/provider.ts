import { RefundTier } from "../booking/cancellation";

/**
 * Contract every outside bus inventory source must meet: an aggregator API, an operator's
 * reservation system, or a GDS. It mirrors the flow these APIs share in India:
 * search -> seat layout -> block (a short hold) -> confirm (issue PNR) -> cancel.
 *
 * EVGO keeps the customer, the wallet, the ticket record and the money; the provider owns the seats,
 * the fares and its own cancellation rules. To add a vendor, write one class that implements this
 * and register it in inventory.registry.ts. Nothing else in the app changes.
 */
export interface BusInventoryProvider {
  /** Short, stable id used in trip ids and the ledger, e.g. "mock-partner". Letters, digits and dashes. */
  readonly id: string;
  readonly displayName: string;

  searchTrips(fromCity: string, toCity: string): Promise<ProviderTrip[]>;
  seatMap(tripRef: string): Promise<ProviderSeatMap>;
  /** Hold seats for a few minutes while EVGO takes payment. */
  block(req: BlockRequest): Promise<BlockResult>;
  /** Turn a block into a confirmed booking. Called only after the wallet has been charged. */
  confirm(blockKey: string): Promise<ConfirmResult>;
  /** Give up a block that will not be paid. Best effort. */
  release(blockKey: string): Promise<void>;
  /** Cancel a confirmed booking. The provider decides the refund under its own rules. */
  cancel(pnr: string, seatLabels: string[]): Promise<CancelResult>;
}

export interface ProviderTrip {
  ref: string;
  operator: string;
  from: string;
  to: string;
  departsAt: Date;
  arrivesAt: Date;
  busType: string;
  seatsLeft: number;
  minFarePaise: number;
  /** Whether the bus is electric, when the provider says so. */
  electric?: boolean;
}

export interface ProviderSeat {
  seatLabel: string;
  farePaise: number;
  status: "available" | "held" | "booked";
}

export interface ProviderSeatMap {
  operator: string;
  routeName: string;
  departsAt: Date;
  seats: ProviderSeat[];
  /** The provider's own cancellation rules, shown to the customer before paying. */
  cancellationPolicy: RefundTier[];
}

export interface BlockRequest {
  tripRef: string;
  seats: { seatLabel: string; passengerName: string }[];
  contactPhone: string;
}

export interface BlockResult {
  blockKey: string;
  expiresAt: Date;
  seats: { seatLabel: string; farePaise: number }[];
}

export interface ConfirmResult {
  pnr: string;
  tickets: { seatLabel: string; ticketNo: string }[];
}

export interface CancelResult {
  refundPaise: number;
}

export type ProviderErrorKind = "not_found" | "seat_unavailable" | "block_expired" | "not_cancellable" | "unavailable";

/** Adapters translate their vendor's errors into one of these kinds. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** Trip ids handed to the apps: EVGO's own trips keep their uuid; partner trips are "p.<provider>.<ref>". */
export const partnerTripId = (providerId: string, ref: string) => `p.${providerId}.${ref}`;

export function parsePartnerTripId(tripId: string): { providerId: string; ref: string } | null {
  const m = /^p\.([a-z0-9-]+)\.(.+)$/.exec(tripId ?? "");
  return m ? { providerId: m[1], ref: m[2] } : null;
}
