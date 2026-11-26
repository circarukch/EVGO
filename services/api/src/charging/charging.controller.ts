import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthUser, CurrentUser } from "../auth/auth.guard";
import { ChargingService } from "./charging.service";

@Controller("charging/sessions")
@UseGuards(AuthGuard)
export class ChargingController {
  constructor(private readonly charging: ChargingService) {}

  /** Start charging on a connector. The QR code on a charger carries the same two values. */
  @Post()
  start(@CurrentUser() user: AuthUser, @Body() body: { chargePointId: string; connectorId: number }) {
    return this.charging.start(user.id, body?.chargePointId, Number(body?.connectorId));
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
