import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Param, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { AdminGuard } from "../admin/admin.guard";
import { config } from "../config";
import { GatewayEvent, NewCharger, NewStation, StationsService } from "./stations.service";

/** Only the OCPP gateway may report charger events and check charger logins. */
@Injectable()
export class GatewayKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const a = Buffer.from(String(ctx.switchToHttp().getRequest().headers["x-gateway-key"] ?? ""));
    const b = Buffer.from(config.gatewayApiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("Gateway key required");
    return true;
  }
}

@Controller("admin")
@UseGuards(AdminGuard)
export class StationsAdminController {
  constructor(private readonly stations: StationsService) {}

  @Get("cpo-operators")
  operators() {
    return this.stations.operators();
  }

  @Get("stations")
  list() {
    return this.stations.list();
  }

  @Post("stations")
  create(@Body() body: NewStation) {
    return this.stations.createStation(body);
  }

  @Get("stations/:siteId")
  get(@Param("siteId") siteId: string) {
    return this.stations.get(siteId);
  }

  @Post("stations/:siteId/chargers")
  addCharger(@Param("siteId") siteId: string, @Body() body: NewCharger) {
    return this.stations.addCharger(siteId, body);
  }

  @Post("chargers/:cp/password")
  rotate(@Param("cp") cp: string) {
    return this.stations.rotatePassword(cp);
  }

  @Get("chargers/:cp/qr")
  qr(@Param("cp") cp: string) {
    return this.stations.qrCodes(cp);
  }

  @Post("chargers/:cp/actions")
  @HttpCode(200)
  action(@Param("cp") cp: string, @Body() body: { action: string; connectorId?: number; idTag?: string; type?: string }) {
    return this.stations.action(cp, body);
  }
}

@Controller("internal/ocpp")
@UseGuards(GatewayKeyGuard)
export class OcppInternalController {
  constructor(private readonly stations: StationsService) {}

  @Post("auth")
  @HttpCode(200)
  async auth(@Body() body: { chargePointId: string; password: string }) {
    return { accepted: await this.stations.verifyChargerLogin(String(body?.chargePointId ?? ""), String(body?.password ?? "")) };
  }

  @Post("events")
  @HttpCode(200)
  event(@Body() body: GatewayEvent) {
    return this.stations.applyEvent(body);
  }
}
