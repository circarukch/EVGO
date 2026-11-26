import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { istClock } from "../common/time";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { PAYMENT_GATEWAY, PaymentGateway } from "../payments/gateway";
import { checkoutRef, gatewayCall } from "../payments/gateway-call";
import { MockPaymentGateway } from "../payments/mock.gateway";
import { RefundsService } from "../payments/refunds.service";
import { GATEWAY_CLEARING, lockWallet, operatorPayable, postJournal, USER_WALLET, walletBalance } from "../wallet/ledger";
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
    private readonly refunds: RefundsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
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
      const order = await this.payableOrder(tx, userId, orderId);
      await lockWallet(tx, wallet.id);
      const balance = await walletBalance(tx, wallet.id);
      if (balance < order.totalPaise) {
        throw new HttpException(
          { message: "Not enough money in wallet", balancePaise: balance, shortfallPaise: order.totalPaise - balance },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      const tickets = await this.issueTickets(tx, order, { account: USER_WALLET, walletId: wallet.id });
      await tx.payment.create({ data: { orderId, method: "wallet", amountPaise: order.totalPaise, status: "SUCCEEDED" } });
      return { orderId, status: "PAID", totalPaise: order.totalPaise, balancePaise: balance - order.totalPaise, payment: { method: "wallet" }, tickets };
    });
  }

  /**
   * Pay by UPI, card or netbanking on Cashfree's checkout. Returns the session the app opens;
   * then the app calls checkCheckout (and Cashfree's webhook does the same).
   */
  async startCheckout(userId: string, orderId: string) {
    const order = await this.db.$transaction((tx) => this.payableOrder(tx, userId, orderId));
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const ref = checkoutRef.order(orderId);
    const payment = await this.db.payment.create({ data: { orderId, method: "online", gatewayRef: ref, amountPaise: order.totalPaise, status: "PENDING" } });
    // Cashfree wants an order to stay open at least 15 minutes. If the customer pays after the seat
    // hold has lapsed and the seats are gone, checkCheckout refunds them in full.
    const expiresAt = new Date(Math.max(order.expiresAt!.getTime(), Date.now() + 16 * 60_000));
    const checkout = await gatewayCall(() =>
      this.gateway.createCheckout({ ref, amountPaise: order.totalPaise, description: "EVGO bus ticket", customerId: userId, customerPhone: user.phone, expiresAt }),
    ).catch(async (e) => {
      await this.db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      throw e;
    });
    return {
      orderId,
      paymentId: payment.id,
      gateway: this.gateway.name,
      amountPaise: order.totalPaise,
      holdExpiresAt: order.expiresAt,
      checkout: { gatewayOrderId: checkout.gatewayRef, paymentSessionId: checkout.paymentSessionId, environment: checkout.environment ?? null },
    };
  }

  /** Was the checkout paid? If so issue the tickets. Safe to call any number of times. */
  async checkCheckout(userId: string | null, orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "desc" } } } });
    if (!order) throw new NotFoundException("Booking not found");
    if (userId && order.userId !== userId) throw new ForbiddenException();
    for (const p of order.payments.filter((x) => x.status === "PENDING" && x.gatewayRef)) {
      const at = await gatewayCall(() => this.gateway.checkoutStatus(p.gatewayRef!));
      if (at.status === "PAID") return this.settleCheckout(order.userId, orderId, p.id, at.method ?? "online");
      if (at.status === "FAILED" || at.status === "EXPIRED") {
        await this.db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED" } });
      }
    }
    return this.orderState(orderId);
  }

  /** Which booking a gateway order id belongs to (for webhooks). */
  async orderIdForPaymentRef(gatewayRef: string) {
    return (await this.db.payment.findUnique({ where: { gatewayRef } }))?.orderId ?? null;
  }

  /** Mock gateway only: stand in for the customer paying on the checkout. */
  async mockPayCheckout(userId: string, orderId: string, method = "upi") {
    if (!config.mockPayments || !(this.gateway instanceof MockPaymentGateway)) throw new NotFoundException();
    const pending = await this.db.payment.findFirst({ where: { orderId, status: "PENDING", gatewayRef: { not: null } }, orderBy: { createdAt: "desc" } });
    if (!pending) throw new NotFoundException("No payment waiting");
    this.gateway.pay(pending.gatewayRef!, method);
    return this.checkCheckout(userId, orderId);
  }

  private async settleCheckout(userId: string, orderId: string, paymentId: string, method: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const flipped = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "SUCCEEDED", method } });
        if (flipped.count === 0) return this.orderState(orderId, tx);
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
        if (order.status !== "PENDING") throw new ConflictException("Already paid");
        const tickets = await this.issueTickets(tx, order, { account: GATEWAY_CLEARING });
        return { orderId, status: "PAID", totalPaise: order.totalPaise, payment: { method }, tickets };
      });
    } catch (e) {
      if (!(e instanceof GoneException || e instanceof ConflictException)) throw e;
      // Paid, but the seats were let go (hold lapsed) or the order was already paid another way:
      // keep the payment on record and send it all back.
      const refundId = await this.db.$transaction(async (tx) => {
        const flipped = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "SUCCEEDED", method } });
        if (flipped.count === 0) return null;
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        await tx.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELLED", expiresAt: null } });
        const r = await tx.refund.create({
          data: { paymentId, gateway: this.gateway.name, amountPaise: payment.amountPaise, reason: "Seats released before payment finished" },
        });
        return r.id;
      });
      if (refundId) await this.refunds.send(refundId);
      const state = await this.orderState(orderId);
      return { ...state, message: "The seat hold ran out before the payment finished, so the full amount is being refunded." };
    }
  }

  private async orderState(orderId: string, db: Prisma.TransactionClient = this.db) {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { include: { refunds: true } }, items: { include: { booking: true } } } });
    const paid = order.payments.find((p) => p.status === "SUCCEEDED");
    return {
      orderId,
      status: order.status,
      totalPaise: order.totalPaise,
      payment: paid ? { method: paid.method } : null,
      refunds: order.payments.flatMap((p) => p.refunds).map((r) => ({ amountPaise: r.amountPaise, status: r.status })),
      tickets: order.status === "PAID"
        ? order.items.filter((i) => i.booking).map((i) => ({ ticketCode: i.booking!.ticketCode, seatLabel: i.booking!.seatLabel, passengerName: i.booking!.passengerName }))
        : [],
    };
  }

  /** The order, if it can still be paid: the customer's, unpaid, and its seat hold still running. */
  private async payableOrder(tx: Prisma.TransactionClient, userId: string, orderId: string) {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundException("Booking not found");
    if (order.userId !== userId) throw new ForbiddenException();
    if (order.status !== "PENDING") throw new ConflictException(`Booking is already ${order.status.toLowerCase()}`);
    if (!order.expiresAt || order.expiresAt < new Date()) throw new GoneException("Seat hold expired. Choose seats again");
    return order;
  }

  /**
   * Turn held seats into tickets and pay the operator. `from` is where the money comes from:
   * the customer's wallet, or the gateway (money received through Cashfree).
   */
  private async issueTickets(
    tx: Prisma.TransactionClient,
    order: { id: string; totalPaise: number; items: { id: string; meta: Prisma.JsonValue }[] },
    from: { account: string; walletId?: string },
  ) {
    const orderId = order.id;
    const metas = order.items.map((i) => i.meta as unknown as SeatMeta);
    const tripId = metas[0].tripId;
    // Still held by this order (a lapsed hold that nobody else took still counts).
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
      { ...from, debitPaise: order.totalPaise, memo: `Bus ticket, ${route.name}` },
      { account: operatorPayable(route.orgId), creditPaise: order.totalPaise, memo: `Order ${orderId}` },
    ]);

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
    return tickets.map((t) => ({ ticketCode: t.ticketCode, seatLabel: t.seatLabel, passengerName: t.passengerName }));
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

  /**
   * Cancel a paid booking under the operator's cancellation policy. The refund goes back the way
   * the customer paid: to the wallet for wallet payments, otherwise through Cashfree to their UPI,
   * card or bank account.
   */
  async cancel(userId: string, orderId: string) {
    const wallet = await this.wallets.walletFor(userId);
    const result = await this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: { include: { booking: true } }, payments: true } });
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
      const paid = order.payments.find((p) => p.status === "SUCCEEDED");
      const toSource = !!paid && paid.method !== "wallet" && !!paid.gatewayRef;
      let refundId: string | null = null;
      if (refundPaise > 0) {
        await postJournal(tx, [
          { account: operatorPayable(trip.schedule.route.orgId), debitPaise: refundPaise, memo: `Refund ${orderId}` },
          toSource
            ? { account: GATEWAY_CLEARING, creditPaise: refundPaise, memo: `Refund to ${paid!.method}, ${trip.schedule.route.name}` }
            : { account: USER_WALLET, walletId: wallet.id, creditPaise: refundPaise, memo: `Refund, ${trip.schedule.route.name}` },
        ]);
        if (toSource) {
          const r = await tx.refund.create({
            data: { paymentId: paid!.id, gateway: this.gateway.name, amountPaise: refundPaise, reason: `Cancelled ${trip.schedule.route.name}` },
          });
          refundId = r.id;
        }
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: refundPaise === order.totalPaise ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
      return {
        orderId,
        refundPaise,
        cancellationFeePaise: order.totalPaise - refundPaise,
        refundTo: refundPaise === 0 ? null : toSource ? paid!.method : "wallet",
        refundId,
        balancePaise: await walletBalance(tx, wallet.id),
      };
    });
    // Sent after the cancellation is saved; if the gateway is down it is retried later.
    const refundStatus = result.refundId ? await this.refunds.send(result.refundId) : result.refundPaise > 0 ? "SUCCEEDED" : null;
    const { refundId: _id, ...rest } = result;
    return { ...rest, refundStatus };
  }

  /** Everything the ticket screen shows: date, boarding and drop, bus, seats and fares, payment, refund, policy. */
  async myBookings(userId: string) {
    const orders = await this.db.order.findMany({
      where: { userId, status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"] }, items: { some: { type: "BUS_SEAT" } } },
      include: {
        payments: true,
        items: {
          include: {
            booking: {
              include: {
                trip: {
                  include: {
                    bus: { include: { org: true } },
                    schedule: { include: { route: { include: { org: true, stops: { include: { place: true }, orderBy: { sequence: "asc" } } } } } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const refunds = await this.db.ledgerEntry.findMany({
      where: { memo: { in: orders.map((o) => `Refund ${o.id}`) }, account: { startsWith: "operator_payable:" } },
    });
    const policyByOrg = new Map<string, Awaited<ReturnType<CancellationPolicyService["get"]>>>();
    const out = [];
    for (const o of orders) {
      const first = o.items[0].booking;
      const trip = first?.trip;
      const route = trip?.schedule.route;
      const stopView = (id?: string) => {
        const st = route?.stops.find((x) => x.id === id);
        if (!st || !trip) return undefined;
        const at = new Date(trip.departsAt.getTime() + st.offsetMinutes * 60_000);
        return { name: st.place.name, city: st.place.city, at, time: istClock(at) };
      };
      if (route && !policyByOrg.has(route.orgId)) policyByOrg.set(route.orgId, await this.policies.get(route.orgId));
      const fares = trip
        ? await this.db.tripSeatInventory.findMany({ where: { tripId: trip.id, seatLabel: { in: o.items.map((i) => i.booking?.seatLabel ?? "") } } })
        : [];
      const paid = o.payments.find((p) => p.status === "SUCCEEDED");
      out.push({
        orderId: o.id,
        status: o.status,
        totalPaise: o.totalPaise,
        bookedAt: o.createdAt,
        route: route?.name,
        departsAt: trip?.departsAt,
        departs: trip ? istClock(trip.departsAt) : undefined,
        boarding: stopView(first?.boardingStopId),
        dropping: stopView(first?.droppingStopId),
        operator: route?.org.name,
        bus: trip?.bus ? { registration: trip.bus.registration } : null,
        payment: paid ? { method: paid.method, amountPaise: paid.amountPaise, at: paid.createdAt } : null,
        refundPaise: refunds.filter((r) => r.memo === `Refund ${o.id}`).reduce((sum, r) => sum + r.debitPaise, 0),
        cancellationPolicy: route ? policyByOrg.get(route.orgId)!.tiers : [],
        tickets: o.items.map((i) => ({
          ticketCode: i.booking?.ticketCode,
          seatLabel: i.booking?.seatLabel,
          passengerName: i.booking?.passengerName,
          status: i.booking?.status,
          farePaise: fares.find((f) => f.seatLabel === i.booking?.seatLabel)?.farePaise ?? i.amountPaise,
        })),
      });
    }
    return out;
  }
}
