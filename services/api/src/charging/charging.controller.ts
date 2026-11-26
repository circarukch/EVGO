import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthUser, CurrentUser } from "../auth/auth.guard";
import { ChargingService } from "./charging.service";

/** Pay for charging with no wallet: block an amount by UPI, start once approved, pay only what was used. */
@Controller("charging/upi-blocks")
@UseGuards(AuthGuard)
export class UpiBlockController {
  constructor(private readonly charging: ChargingService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: { chargePointId: string; connectorId: number; amountPaise: number }) {
    return this.charging.createUpiBlock(user.id, body?.chargePointId, Number(body?.connectorId), Number(body?.amountPaise));
  }

  /** Poll after the customer returns from their UPI app: starts charging once the amount is blocked. */
  @Post(":id/start")
  start(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.startWithUpiBlock(user.id, id);
  }

  @Delete(":id")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.cancelUpiBlock(user.id, id);
  }

  @Post(":id/mock-approve")
  mockApprove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.mockUpiDecision(user.id, id, true);
  }

  @Post(":id/mock-decline")
  mockDecline(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.mockUpiDecision(user.id, id, false);
  }
}

@Controller("charging/sessions")
@UseGuards(AuthGuard)
export class ChargingController {
  constructor(private readonly charging: ChargingService) {}

  /** Start charging on a connector. The QR code on a charger carries the same two values. */
  @Post()
  start(@CurrentUser() user: AuthUser, @Body() body: { chargePointId: string; connectorId: number }) {
    return this.charging.start(user.id, body?.chargePointId, Number(body?.connectorId));
  }

  /** Latest sessions, the running one first (Home: 5; Recent activity: up to 50). */
  @Get()
  recent(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    return this.charging.recent(user.id, limit ? Number(limit) : 5);
  }

  @Get("active")
  active(@CurrentUser() user: AuthUser) {
    return this.charging.active(user.id);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.view(user.id, id);
  }

  @Post(":id/stop")
  stop(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.charging.stop(user.id, id);
  }
}
