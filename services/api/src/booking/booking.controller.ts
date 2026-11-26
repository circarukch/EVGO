import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthUser, CurrentUser } from "../auth/auth.guard";
import { BookingService, SeatRequest } from "./booking.service";

@Controller()
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Get("trips/:id/seats")
  seats(@Param("id") id: string) {
    return this.bookings.seats(id);
  }

  @Post("bookings")
  @UseGuards(AuthGuard)
  hold(@CurrentUser() user: AuthUser, @Body() body: { tripId: string; seats: SeatRequest[] }) {
    return this.bookings.hold(user.id, body?.tripId, body?.seats);
  }

  @Get("bookings")
  @UseGuards(AuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.bookings.myBookings(user.id);
  }

  @Post("bookings/:id/pay")
  @UseGuards(AuthGuard)
  pay(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.bookings.payWithWallet(user.id, id);
  }

  /** Pay by UPI, card or netbanking on Cashfree's checkout. */
  @Post("bookings/:id/checkout")
  @UseGuards(AuthGuard)
  checkout(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.bookings.startCheckout(user.id, id);
  }

  @Post("bookings/:id/checkout/check")
  @UseGuards(AuthGuard)
  check(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.bookings.checkCheckout(user.id, id);
  }

  @Post("bookings/:id/checkout/mock-pay")
  @UseGuards(AuthGuard)
  mockPay(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: { method?: string }) {
    return this.bookings.mockPayCheckout(user.id, id, body?.method);
  }

  @Delete("bookings/:id/hold")
  @UseGuards(AuthGuard)
  release(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.bookings.releaseHold(user.id, id);
  }

  @Post("bookings/:id/cancel")
  @UseGuards(AuthGuard)
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.bookings.cancel(user.id, id);
  }
}
