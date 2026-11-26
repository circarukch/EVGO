import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { istClock } from "../common/time";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { lockWallet, operatorPayable, postJournal, USER_WALLET, walletBalance } from "../wallet/ledger";
import { WalletService } from "../wallet/wallet.service";
import { cutoffHours, refundShare } from "./cancellation";
import { CancellationPolicyService } from "./cancellation-policy.service";

export interface SeatRequest {
  seatLabel: string;
  passengerName: string;
}

interface SeatMeta {
  tripId: string;
  seatLabel: string;
  passengerName: string;
}

const ticketCode = () => randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 8);

/** A seat is free if it is available, or its hold has run out. */
const seatIsFree = (now: Date): Prisma.TripSeatInventoryWhereInput => ({
  OR: [{ status: "available" }, { status: "held", heldUntil: { lt: now } }],
});

@Injectable()
export class BookingService {
  constructor(
    private readonly db: PrismaService,
    private readonly wallets: WalletService,
    private readonly policies: CancellationPolicyService,
  ) {}

  async seats(tripId: string) {
    const trip = await this.db.trip.findUnique({
      where: { id: tripId },
      include: { inventory: { orderBy: { seatLabel: "asc" } }, schedule: { include: { route: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    const now = new Date();
    const policy = await this.policies.get(trip.schedule.route.orgId);
    return {
      tripId,
      departsAt: trip.departsAt,
      cancellationPolicy: policy.tiers,
      seats: trip.inventory.map((s) => ({
        seatLabel: s.seatLabel,
        farePaise: s.farePaise,
        status: s.status === "held" && s.heldUntil && s.heldUntil < now ? "available" : s.status,
      })),
    };
  }

  /** Hold seats for a few minutes while the customer pays. */
  async hold(userId: string, tripId: string, seats: SeatRequest[]) {
    if (!Array.isArray(seats) || seats.length === 0 || seats.length > config.maxSeatsPerBooking) {
      throw new BadRequestException(`Choose between 1 and ${config.maxSeatsPerBooking} seats`);
    }
    const labels = seats.map((s) => s.seatLabel);
    if (new Set(labels).size !== labels.length) throw new BadRequestException("Each seat can be chosen once");
    if (seats.some((s) => !s.passengerName?.trim())) throw new BadRequestException("Every seat needs a passenger name");

    const trip = await this.db.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException("Trip not found");
    const now = new Date();
    if (trip.status !== "scheduled" || trip.departsAt <= now) throw new BadRequestException("This trip is no longer open for booking");

    const heldUntil = new Date(now.getTime() + config.seatHoldMinutes * 60_000);
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { userId, totalPaise: 0, expiresAt: heldUntil } });
      let totalPaise = 0;
      for (const s of seats) {
        // Conditional update: only one concurrent request can move a free seat to held.
        const claimed = await tx.tripSeatInventory.updateMany({
          where: { tripId, seatLabel: s.seatLabel, ...seatIsFree(now) },
          data: { status: "held", heldUntil, holdOrderId: order.id },
        });
        if (claimed.count !== 1) throw new ConflictException(`Seat ${s.seatLabel} is not available`);
        const seat = await tx.tripSeatInventory.findUniqueOrThrow({ where: { tripId_seatLabel: { tripId, seatLabel: s.seatLabel } } });
        totalPaise += seat.farePaise;
        const meta: SeatMeta = { tripId, seatLabel: s.seatLabel, passengerName: s.passengerName.trim() };
        await tx.orderItem.create({ data: { orderId: order.id, type: "BUS_SEAT", amountPaise: seat.farePaise, meta: { ...meta } } });
      }
      await tx.order.update({ where: { id: order.id }, data: { totalPaise } });
      return { orderId: order.id, status: "PENDING", totalPaise, expiresAt: heldUntil, seats: labels };
    });
  }

  /** Pay for held seats from the wallet and issue tickets. */
  async payWithWallet(userId: string, orderId: string) {
    const wallet = await this.wallets.walletFor(userId);
    return this.db.$transaction(async (tx) => {
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

      const metas = order.items.map((i) => i.meta as unknown as SeatMeta);
      const tripId = metas[0].tripId;
      const booked = await tx.tripSeatInventory.updateMany({
        where: { tripId, holdOrderId: orderId, status: "held" },
        data: { status: "booked", heldUntil: null },
      });
      if (booked.count !== order.items.length) throw new GoneException("Seat hold expired. Choose seats again");

      const trip = await tx.trip.findUniqueOrThrow({
        where: { id: tripId },
        include: { schedule: { include: { route: { include: { stops: { orderBy: { sequence: "asc" } } } } } } },
      });
      const route = trip.schedule.route;
      await postJournal(tx, [
        { account: USER_WALLET, walletId: wallet.id, debitPaise: order.totalPaise, memo: `Bus ticket, ${route.name}` },
        { account: operatorPayable(route.orgId), creditPaise: order.totalPaise, memo: `Order ${orderId}` },
      ]);
      await tx.payment.create({ data: { orderId, method: "wallet", amountPaise: order.totalPaise, status: "SUCCEEDED" } });

      const tickets = [];
      for (const [i, item] of order.items.entries()) {
        const meta = metas[i];
        tickets.push(
          await tx.booking.create({
            data: {
              orderItemId: item.id,
              tripId,
              seatLabel: meta.seatLabel,
              passengerName: meta.passengerName,
              boardingStopId: route.stops[0].id,
              droppingStopId: route.stops[route.stops.length - 1].id,
              ticketCode: ticketCode(),
            },
          }),
        );
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "PAID", expiresAt: null } });
      return {
        orderId,
        status: "PAID",
        totalPaise: order.totalPaise,
        balancePaise: balance - order.totalPaise,
        tickets: tickets.map((t) => ({ ticketCode: t.ticketCode, seatLabel: t.seatLabel, passengerName: t.passengerName })),
      };
    });
  }

  /** Let go of held seats without paying. */
  async releaseHold(userId: string, orderId: string) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException("Booking not found");
      if (order.userId !== userId) throw new ForbiddenException();
      if (order.status !== "PENDING") throw new ConflictException("Only unpaid holds can be released");
      await tx.tripSeatInventory.updateMany({
        where: { holdOrderId: orderId, status: "held" },
        data: { status: "available", heldUntil: null, holdOrderId: null },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", expiresAt: null } });
      return { orderId, status: "CANCELLED" };
    });
  }

  /** Cancel a paid booking and refund to the wallet under the cancellation policy. */
  async cancel(userId: string, orderId: string) {
    const wallet = await this.wallets.walletFor(userId);
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { booking: true } } } });
      if (!order) throw new NotFoundException("Booking not found");
      if (order.userId !== userId) throw new ForbiddenException();
      if (order.status !== "PAID") throw new ConflictException("Only paid bookings can be cancelled");
      const tripId = order.items[0].booking!.tripId;
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: { schedule: { include: { route: true } } } });
      const hours = (trip.departsAt.getTime() - Date.now()) / 3_600_000;
      const { tiers } = await this.policies.get(trip.schedule.route.orgId, tx);
      const share = refundShare(hours, tiers);
      if (share === null) throw new BadRequestException(`Cancellation closes ${cutoffHours(tiers)} hours before departure`);

      const refundPaise = Math.floor(order.totalPaise * share);
      // Only flip bookings that are still confirmed, so a double cancel cannot refund twice.
      const flipped = await tx.booking.updateMany({
        where: { orderItemId: { in: order.items.map((i) => i.id) }, status: "CONFIRMED" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (flipped.count !== order.items.length) throw new ConflictException("Booking is already cancelled");
      await tx.tripSeatInventory.updateMany({
        where: { tripId, holdOrderId: orderId, status: "booked" },
        data: { status: "available", holdOrderId: null },
      });
      if (refundPaise > 0) {
        await postJournal(tx, [
          { account: operatorPayable(trip.schedule.route.orgId), debitPaise: refundPaise, memo: `Refund ${orderId}` },
          { account: USER_WALLET, walletId: wallet.id, creditPaise: refundPaise, memo: `Refund, ${trip.schedule.route.name}` },
        ]);
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: refundPaise === order.totalPaise ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      return { orderId, refundPaise, cancellationFeePaise: order.totalPaise - refundPaise, balancePaise: await walletBalance(tx, wallet.id) };
    });
  }

  async myBookings(userId: string) {
    const orders = await this.db.order.findMany({
      where: { userId, status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] }, items: { some: { type: "BUS_SEAT" } } },
      include: { items: { include: { booking: { include: { trip: { include: { schedule: { include: { route: true } } } } } } } } },
      orderBy: { createdAt: "desc" },
    });
    return orders.map((o) => {
      const trip = o.items[0].booking?.trip;
      return {
        orderId: o.id,
        status: o.status,
        totalPaise: o.totalPaise,
        route: trip?.schedule.route.name,
        departsAt: trip?.departsAt,
        departs: trip ? istClock(trip.departsAt) : undefined,
        tickets: o.items.map((i) => ({
          ticketCode: i.booking?.ticketCode,
          seatLabel: i.booking?.seatLabel,
          passengerName: i.booking?.passengerName,
          status: i.booking?.status,
        })),
      };
    });
  }
}
