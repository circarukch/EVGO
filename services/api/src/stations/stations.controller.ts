import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, NotFoundException, Param, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { AdminGuard, CurrentOperator, OperatorPrincipal, OperatorRoles } from "../admin/admin.guard";
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

/** Stations and chargers. Admins see all; a station operator sees and changes only their own organisation's. */
@Controller("admin")
@UseGuards(AdminGuard)
@OperatorRoles("admin", "station_operator")
export class StationsAdminController {
  constructor(private readonly stations: StationsService) {}

  /** Org a station operator is limited to; null for admins. */
  private scope(op: OperatorPrincipal) {
    return op.role === "admin" ? null : op.orgId;
  }

  // "Not found" rather than "forbidden", so other operators' station and charger IDs stay private.
  private async ownSite(op: OperatorPrincipal, siteId: string) {
    const only = this.scope(op);
    if (only && (await this.stations.siteOrgId(siteId)) !== only) throw new NotFoundException("Station not found");
  }

  private async ownCharger(op: OperatorPrincipal, cp: string) {
    const only = this.scope(op);
    if (only && (await this.stations.chargerOrgId(cp)) !== only) throw new NotFoundException("Charger not found");
  }

  @Get("cpo-operators")
  operators(@CurrentOperator() op: OperatorPrincipal) {
    return this.stations.operators(this.scope(op));
  }

  @Get("stations")
  list(@CurrentOperator() op: OperatorPrincipal) {
    return this.stations.list(this.scope(op));
  }

  @Post("stations")
  create(@CurrentOperator() op: OperatorPrincipal, @Body() body: NewStation) {
    const only = this.scope(op);
    // A station operator always adds to their own organisation and cannot create new ones.
    return this.stations.createStation(only ? { ...body, orgId: only, newOperatorName: undefined } : body);
  }

  @Get("stations/:siteId")
  async get(@CurrentOperator() op: OperatorPrincipal, @Param("siteId") siteId: string) {
    await this.ownSite(op, siteId);
    return this.stations.get(siteId);
  }

  @Post("stations/:siteId/chargers")
  async addCharger(@CurrentOperator() op: OperatorPrincipal, @Param("siteId") siteId: string, @Body() body: NewCharger) {
    await this.ownSite(op, siteId);
    return this.stations.addCharger(siteId, body);
  }

  @Post("chargers/:cp/password")
  async rotate(@CurrentOperator() op: OperatorPrincipal, @Param("cp") cp: string) {
    await this.ownCharger(op, cp);
    return this.stations.rotatePassword(cp);
  }

  @Get("chargers/:cp/qr")
  async qr(@CurrentOperator() op: OperatorPrincipal, @Param("cp") cp: string) {
    await this.ownCharger(op, cp);
    return this.stations.qrCodes(cp);
  }

  @Post("chargers/:cp/actions")
  @HttpCode(200)
  async action(
    @CurrentOperator() op: OperatorPrincipal,
    @Param("cp") cp: string,
    @Body() body: { action: string; connectorId?: number; idTag?: string; type?: string },
  ) {
    await this.ownCharger(op, cp);
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
