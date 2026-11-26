import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { istClock } from "../common/time";
import { InventoryRegistry } from "../inventory/inventory.registry";
import { BusInventoryProvider, partnerTripId, parsePartnerTripId, ProviderError } from "../inventory/provider";
import { PrismaService } from "../prisma/prisma.service";
import { lockWallet, partnerPayable, postJournal, USER_WALLET, walletBalance } from "../wallet/ledger";
import { WalletService } from "../wallet/wallet.service";
import type { SeatRequest } from "./booking.service";

/** What a partner seat order item remembers between hold and payment. */
export interface PartnerSeatMeta {
  kind: "partner";
  providerId: string;
  tripRef: string;
  blockKey: string;
  seatLabel: string;
  passengerName: string;
  operator: string;
  routeName: string;
  departsAt: string;
}

/** Turn an adapter's error into the HTTP answer the apps already understand. */
function toHttp(e: unknown): never {
  if (!(e instanceof ProviderError)) throw e;
  switch (e.kind) {
    case "not_found":
      throw new NotFoundException(e.message);
    case "seat_unavailable":
      throw new ConflictException(e.message);
    case "block_expired":
      throw new GoneException(e.message);
    case "not_cancellable":
      throw new BadRequestException(e.message);
    default:
      throw new BadGatewayException("The bus company is not responding. Please try again in a minute");
  }
}

/**
 * Bookings on partner inventory. Same API and same wallet as EVGO's own buses; the seats live with the
 * partner, so every step that touches them is a call to its adapter, with the wallet put right if the
 * partner fails after we have charged it.
 */
@Injectable()
export class PartnerBookingService {
  constructor(
    private readonly db: PrismaService,
    private readonly wallets: WalletService,
    private readonly registry: InventoryRegistry,
  ) {}

  /** Trip search results from every switched-on partner, in the same shape as EVGO's own. */
  async searchTrips(fromCity: string, toCity: string) {
    const lists = await Promise.all(
      this.registry.all().map(async (p) => {
        try {
          return (await p.searchTrips(fromCity, toCity)).map((t) => ({ provider: p, t }));
        } catch {
          return []; // one partner being down must not break search
        }
      }),
    );
    return lists.flat().map(({ provider, t }) => ({
      id: partnerTripId(provider.id, t.ref),
      provider: provider.id,
      operator: t.operator,
      from: t.from,
      to: t.to,
      departsAt: t.departsAt,
      arrivesAt: t.arrivesAt,
      departs: istClock(t.departsAt),
      arrives: istClock(t.arrivesAt),
      busType: t.busType,
      electric: t.electric ?? null,
      seatsLeft: t.seatsLeft,
      fareInr: t.minFarePaise / 100,
      chargersAtBoarding: 0,
    }));
  }

  private provider(id: string): BusInventoryProvider {
    const p = this.registry.get(id);
    if (!p) throw new NotFoundException("Trip not found");
    return p;
  }

  isPartnerTrip(tripId: string) {
    return parsePartnerTripId(tripId) !== null;
  }

  /** True when the order holds partner seats. */
  async ownsOrder(orderId: string) {
    const item = await this.db.orderItem.findFirst({ where: { orderId, meta: { path: ["kind"], equals: "partner" } } });
    return item !== null;
  }

  async seats(tripId: string) {
    const { providerId, ref } = parsePartnerTripId(tripId)!;
    const map = await this.provider(providerId).seatMap(ref).catch(toHttp);
    return {
      tripId,
      provider: providerId,
      departsAt: map.departsAt,
      cancellationPolicy: map.cancellationPolicy,
      seats: map.seats,
    };
  }

  async hold(userId: string, tripId: string, seats: SeatRequest[]) {
    const { providerId, ref } = parsePartnerTripId(tripId)!;
    const provider = this.provider(providerId);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const map = await provider.seatMap(ref).catch(toHttp);
    if (map.departsAt <= new Date()) throw new BadRequestException("This trip is no longer open for booking");
    const cleaned = seats.map((s) => ({ seatLabel: s.seatLabel, passengerName: s.passengerName.trim() }));
    const block = await provider.block({ tripRef: ref, seats: cleaned, contactPhone: user.phone }).catch(toHttp);

    const totalPaise = block.seats.reduce((sum, s) => sum + s.farePaise, 0);
    try {
      const order = await this.db.order.create({
        data: {
          userId,
          totalPaise,
          expiresAt: block.expiresAt,
          items: {
            create: block.seats.map((s) => {
              const meta: PartnerSeatMeta = {
                kind: "partner",
                providerId,
                tripRef: ref,
                blockKey: block.blockKey,
                seatLabel: s.seatLabel,
                passengerName: cleaned.find((c) => c.seatLabel === s.seatLabel)!.passengerName,
                operator: map.operator,
                routeName: map.routeName,
                departsAt: map.departsAt.toISOString(),
              };
              return { type: "BUS_SEAT" as const, amountPaise: s.farePaise, meta: { ...meta } };
            }),
          },
        },
      });
      return { orderId: order.id, status: "PENDING", totalPaise, expiresAt: block.expiresAt, seats: block.seats.map((s) => s.seatLabel) };
    } catch (e) {
      await provider.release(block.blockKey).catch(() => undefined);
      throw e;
    }
  }

  async payWithWallet(userId: string, orderId: string) {
    const wallet = await this.wallets.walletFor(userId);
    // 1. Charge the wallet and claim the order, so a second tap cannot pay twice.
    const charged = await this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException("Booking not found");
      if (order.userId !== userId) throw new ForbiddenException();
      if (order.status !== "PENDING") throw new ConflictException(`Booking is already ${order.status.toLowerCase()}`);
      if (!order.expiresAt || order.expiresAt < new Date()) throw new GoneException("Seat hold expired. Choose seats again");
      await lockWallet(tx, wallet.id);
      const balance = await walletBalance(tx, wallet.id);
      if (balance < order.totalPaise) {
        throw new HttpException(
          { message: "Not enough money in wallet", balancePaise: balance, shortfallPaise: order.totalPaise - balance },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      const claimed = await tx.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "PAID", expiresAt: null } });
      if (claimed.count !== 1) throw new ConflictException("Booking is already being paid");
      const metas = order.items.map((i) => i.meta as unknown as PartnerSeatMeta);
      await postJournal(tx, [
        { account: USER_WALLET, walletId: wallet.id, debitPaise: order.totalPaise, memo: `Bus ticket, ${metas[0].routeName}` },
        { account: partnerPayable(metas[0].providerId), creditPaise: order.totalPaise, memo: `Order ${orderId}` },
      ]);
      const payment = await tx.payment.create({ data: { orderId, method: "wallet", amountPaise: order.totalPaise, status: "SUCCEEDED" } });
      return { order, metas, paymentId: payment.id, balance };
    });

    // 2. Ask the partner to issue the tickets. If it cannot, give the money back.
    const { order, metas } = charged;
    let confirmed;
    try {
      confirmed = await this.provider(metas[0].providerId).confirm(metas[0].blockKey);
    } catch (e) {
      await this.db.$transaction(async (tx) => {
        await postJournal(tx, [
          { account: partnerPayable(metas[0].providerId), debitPaise: order.totalPaise, memo: `Reversal ${orderId}` },
          { account: USER_WALLET, walletId: wallet.id, creditPaise: order.totalPaise, memo: "Booking failed, money returned" },
        ]);
        await tx.payment.update({ where: { id: charged.paymentId }, data: { status: "REVERSED" } });
        await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
      });
      if (e instanceof ProviderError && e.kind === "block_expired") throw new GoneException("Seat hold expired. Your money is back in your wallet");
      throw new BadGatewayException("The bus company could not confirm your seats. Your money is back in your wallet");
    }

    // 3. Keep EVGO's own record of the tickets.
    const tickets = await this.db.$transaction(async (tx) =>
      Promise.all(
        order.items.map((item, i) => {
          const meta = metas[i];
          const ticket = confirmed.tickets.find((t) => t.seatLabel === meta.seatLabel);
          return tx.partnerBooking.create({
            data: {
              orderItemId: item.id,
              providerId: meta.providerId,
              tripRef: meta.tripRef,
              pnr: confirmed.pnr,
              ticketNo: ticket?.ticketNo ?? confirmed.pnr,
              seatLabel: meta.seatLabel,
              passengerName: meta.passengerName,
              operator: meta.operator,
              routeName: meta.routeName,
              departsAt: new Date(meta.departsAt),
            },
          });
        }),
      ),
    );
    return {
      orderId,
      status: "PAID",
      totalPaise: order.totalPaise,
      balancePaise: charged.balance - order.totalPaise,
      pnr: confirmed.pnr,
      tickets: tickets.map((t) => ({ ticketCode: t.ticketNo, seatLabel: t.seatLabel, passengerName: t.passengerName })),
    };
  }

  async releaseHold(userId: string, orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException("Booking not found");
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== "PENDING") throw new ConflictException("Only unpaid holds can be released");
    const meta = order.items[0].meta as unknown as PartnerSeatMeta;
    await this.provider(meta.providerId)
      .release(meta.blockKey)
      .catch(() => undefined); // the partner's block lapses on its own anyway
    await this.db.order.update({ where: { id: orderId }, data: { status: "CANCELLED", expiresAt: null } });
    return { orderId, status: "CANCELLED" };
  }

  /** Cancel with the partner; it decides the refund under its own rules. */
  async cancel(userId: string, orderId: string) {
    const wallet = await this.wallets.walletFor(userId);
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { items: { include: { partnerBooking: true } } } });
    if (!order) throw new NotFoundException("Booking not found");
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== "PAID") throw new ConflictException("Only paid bookings can be cancelled");
    const bookings = order.items.map((i) => i.partnerBooking!);
    const ids = bookings.map((b) => b.id);

    // Claim first so a double tap cannot refund twice; undo the claim if the partner says no.
    const claimed = await this.db.partnerBooking.updateMany({
      where: { id: { in: ids }, status: "CONFIRMED" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (claimed.count !== ids.length) throw new ConflictException("Booking is already cancelled");
    let refundPaise: number;
    try {
      ({ refundPaise } = await this.provider(bookings[0].providerId).cancel(
        bookings[0].pnr,
        bookings.map((b) => b.seatLabel),
      ));
    } catch (e) {
      await this.db.partnerBooking.updateMany({ where: { id: { in: ids } }, data: { status: "CONFIRMED", cancelledAt: null } });
      toHttp(e);
    }
    refundPaise = Math.min(refundPaise, order.totalPaise);

    return this.db.$transaction(async (tx) => {
      if (refundPaise > 0) {
        await postJournal(tx, [
          { account: partnerPayable(bookings[0].providerId), debitPaise: refundPaise, memo: `Refund ${orderId}` },
          { account: USER_WALLET, walletId: wallet.id, creditPaise: refundPaise, memo: `Refund, ${bookings[0].routeName}` },
        ]);
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: refundPaise === order.totalPaise ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      return { orderId, refundPaise, cancellationFeePaise: order.totalPaise - refundPaise, balancePaise: await walletBalance(tx, wallet.id) };
    });
  }
}
