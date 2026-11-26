import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConnectorType, Prisma, VehicleSegment } from "@prisma/client";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { GatewayClient } from "./gateway-client";
import { checkChargerPassword, hashChargerPassword, newChargerPassword } from "./ocpp-password";

const CONNECTOR_TYPES: Record<string, { type: ConnectorType; current: "AC" | "DC"; label: string }> = {
  CCS2: { type: "CCS2", current: "DC", label: "CCS2" },
  TYPE2: { type: "TYPE2", current: "AC", label: "Type 2" },
  GBT: { type: "GBT", current: "DC", label: "GB/T" },
  BHARAT_DC001: { type: "BHARAT_DC001", current: "DC", label: "Bharat DC-001" },
  LEV_AC: { type: "LEV_AC", current: "AC", label: "LEV AC" },
  LECCS: { type: "LECCS", current: "DC", label: "LECCS" },
};
const SEGMENTS: Record<string, VehicleSegment> = {
  "2W": "TWO_WHEELER",
  "3W": "THREE_WHEELER",
  "4W": "FOUR_WHEELER",
  BUS: "BUS",
  TRUCK: "TRUCK",
};
const SEGMENT_LABEL = Object.fromEntries(Object.entries(SEGMENTS).map(([k, v]) => [v, k])) as Record<VehicleSegment, string>;

/** Same rule as the gateway URL: what may follow /ocpp/ in the address. */
const CHARGE_POINT_ID = /^[A-Za-z0-9._-]{3,48}$/;
/** A charger that has not been heard from for this long is shown offline even if its socket looks open. */
const STALE_MS = 15 * 60_000;

export interface NewStation {
  name: string;
  city: string;
  lat: number;
  lng: number;
  orgId?: string;
  newOperatorName?: string;
  access?: "public" | "fleet_only";
}

export interface NewConnector {
  type: string;
  powerKw: number;
  pricePerKwhInr: number;
  segments?: string[];
}

export interface NewCharger {
  chargePointId: string;
  vendor?: string;
  model?: string;
  connectors: NewConnector[];
}

/** Events the OCPP gateway reports, as posted to /internal/ocpp/events. */
export type GatewayEvent =
  | { type: "charger.connected"; chargePointId: string }
  | { type: "charger.disconnected"; chargePointId: string }
  | { type: "charger.heartbeat"; chargePointId: string }
  | { type: "charger.booted"; chargePointId: string; vendor: string; model: string; firmware?: string }
  | { type: "connector.status"; chargePointId: string; connectorId: number; status: string; errorCode?: string }
  | { type: string; chargePointId: string };

const stationInclude = {
  place: true,
  org: true,
  chargers: { include: { connectors: { include: { tariff: true }, orderBy: { ocppId: "asc" } } }, orderBy: { chargePointId: "asc" } },
} satisfies Prisma.SiteInclude;
type StationRow = Prisma.SiteGetPayload<{ include: typeof stationInclude }>;

/** Operator console: add stations and chargers, give chargers their OCPP login, watch and command them. */
@Injectable()
export class StationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: GatewayClient,
  ) {}

  ocppUrl(chargePointId: string) {
    return `${config.ocppPublicUrl}/${encodeURIComponent(chargePointId)}`;
  }

  async operators() {
    const orgs = await this.db.organisation.findMany({ where: { kinds: { hasSome: ["CPO", "PLATFORM"] } }, orderBy: { name: "asc" } });
    return orgs.map((o) => ({ id: o.id, name: o.name }));
  }

  async list() {
    const rows = await this.db.site.findMany({ include: stationInclude, orderBy: { name: "asc" } });
    return rows.map((r) => this.present(r));
  }

  async get(siteId: string) {
    const row = await this.db.site.findUnique({ where: { id: siteId }, include: stationInclude });
    if (!row) throw new NotFoundException("Station not found");
    return this.present(row);
  }

  async createStation(input: NewStation) {
    const name = input?.name?.trim();
    const city = input?.city?.trim();
    const lat = Number(input?.lat);
    const lng = Number(input?.lng);
    if (!name || !city) throw new BadRequestException("Station name and city are required");
    // India only: a typo in the coordinates should not put a station in the sea.
    if (!(lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5)) throw new BadRequestException("Location must be in India (check latitude and longitude)");
    let orgId = input.orgId;
    if (!orgId && input.newOperatorName?.trim()) {
      const org = await this.db.organisation.create({ data: { name: input.newOperatorName.trim(), kinds: ["CPO"] } });
      orgId = org.id;
    }
    if (!orgId || !(await this.db.organisation.findUnique({ where: { id: orgId } }))) throw new BadRequestException("Choose the operator");
    const access = input.access === "fleet_only" ? "fleet_only" : "public";
    const site = await this.db.$transaction(async (tx) => {
      const place = await tx.place.create({ data: { name, city, lat, lng, isSite: true } });
      return tx.site.create({ data: { name, orgId: orgId!, placeId: place.id, access } });
    });
    return this.get(site.id);
  }

  /** Adds a charger and returns its OCPP login. The password is shown this once; only a hash is kept. */
  async addCharger(siteId: string, input: NewCharger) {
    const site = await this.db.site.findUnique({ where: { id: siteId } });
    if (!site) throw new NotFoundException("Station not found");
    const chargePointId = input?.chargePointId?.trim().toUpperCase();
    if (!chargePointId || !CHARGE_POINT_ID.test(chargePointId)) {
      throw new BadRequestException("Charger ID: 3 to 48 letters, digits, dots, dashes or underscores, e.g. GNT-HUB-03");
    }
    const connectors = input.connectors ?? [];
    if (connectors.length < 1 || connectors.length > 8) throw new BadRequestException("Add 1 to 8 plugs");
    const parsed = connectors.map((c, i) => {
      const kind = CONNECTOR_TYPES[String(c.type).toUpperCase()];
      const powerKw = Number(c.powerKw);
      const price = Number(c.pricePerKwhInr);
      if (!kind) throw new BadRequestException(`Plug ${i + 1}: choose a plug type`);
      if (!(powerKw > 0 && powerKw <= 1000)) throw new BadRequestException(`Plug ${i + 1}: power must be between 0 and 1000 kW`);
      if (!(price > 0 && price <= 100)) throw new BadRequestException(`Plug ${i + 1}: price must be between ₹0 and ₹100 per kWh`);
      const segments = (c.segments ?? []).map((s) => SEGMENTS[String(s).toUpperCase()]).filter(Boolean);
      return { ocppId: i + 1, kind, powerKw, perKwhPaise: Math.round(price * 100), segments: segments.length ? segments : (["FOUR_WHEELER"] as VehicleSegment[]) };
    });
    if (await this.db.charger.findUnique({ where: { chargePointId } })) throw new ConflictException(`Charger ID ${chargePointId} is already used`);

    const password = newChargerPassword();
    await this.db.$transaction(async (tx) => {
      const charger = await tx.charger.create({
        data: { siteId, chargePointId, vendor: input.vendor?.trim() || null, model: input.model?.trim() || null, ocppPasswordHash: hashChargerPassword(password) },
      });
      for (const p of parsed) {
        const tariff =
          (await tx.tariff.findFirst({ where: { orgId: site.orgId, perKwhPaise: p.perKwhPaise, perMinutePaise: 0, sessionFeePaise: 0, idleFeePerMinPaise: 0 } })) ??
          (await tx.tariff.create({ data: { orgId: site.orgId, name: `₹${p.perKwhPaise / 100}/kWh`, perKwhPaise: p.perKwhPaise } }));
        await tx.connector.create({
          // Unavailable until the charger connects and reports its real status.
          data: { chargerId: charger.id, ocppId: p.ocppId, type: p.kind.type, maxPowerKw: p.powerKw, segments: p.segments, tariffId: tariff.id, status: "Unavailable" },
        });
      }
    });
    return { station: await this.get(siteId), connection: this.connection(chargePointId, password) };
  }

  /** New password for a charger (lost, or installer changed). The old one stops working at once. */
  async rotatePassword(chargePointId: string) {
    const charger = await this.charger(chargePointId);
    const password = newChargerPassword();
    await this.db.charger.update({ where: { id: charger.id }, data: { ocppPasswordHash: hashChargerPassword(password) } });
    return this.connection(charger.chargePointId, password);
  }

  /** What to type into the charger's settings. */
  private connection(chargePointId: string, password: string) {
    return {
      chargePointId,
      url: this.ocppUrl(chargePointId),
      username: chargePointId,
      password,
      ocppVersion: "1.6J",
      securityProfile: config.ocppPublicUrl.startsWith("wss:") ? 2 : 1,
    };
  }

  /** The QR on each plug: the app reads EVGO:<charger>:<plug> and starts charging there. */
  async qrCodes(chargePointId: string) {
    const c = await this.db.charger.findUnique({ where: { chargePointId }, include: { connectors: { orderBy: { ocppId: "asc" } }, site: { include: { place: true } } } });
    if (!c) throw new NotFoundException("Charger not found");
    return {
      station: c.site.place.name,
      chargePointId: c.chargePointId,
      codes: c.connectors.map((k) => ({
        connectorId: k.ocppId,
        payload: `EVGO:${c.chargePointId}:${k.ocppId}`,
        printedCode: `${c.chargePointId}-${k.ocppId}`,
        label: `${CONNECTOR_TYPES[k.type]?.label ?? k.type} · ${CONNECTOR_TYPES[k.type]?.current ?? ""} · ${Number(k.maxPowerKw)} kW`,
      })),
    };
  }

  // ---------- From the OCPP gateway ----------

  async verifyChargerLogin(chargePointId: string, password: string): Promise<boolean> {
    const c = await this.db.charger.findUnique({ where: { chargePointId } });
    return !!c && checkChargerPassword(password ?? "", c.ocppPasswordHash);
  }

  async applyEvent(e: GatewayEvent) {
    const c = await this.db.charger.findUnique({ where: { chargePointId: e.chargePointId } });
    if (!c) return { ok: false };
    const now = new Date();
    switch (e.type) {
      case "charger.connected":
        await this.db.charger.update({ where: { id: c.id }, data: { online: true, connectedAt: now, lastSeenAt: now } });
        break;
      case "charger.disconnected":
        await this.db.charger.update({ where: { id: c.id }, data: { online: false, lastSeenAt: now } });
        // Nothing is known about the plugs until it is back.
        await this.db.connector.updateMany({ where: { chargerId: c.id, status: { notIn: ["Charging"] } }, data: { status: "Unavailable" } });
        break;
      case "charger.heartbeat":
        await this.db.charger.update({ where: { id: c.id }, data: { online: true, lastSeenAt: now } });
        break;
      case "charger.booted": {
        const b = e as Extract<GatewayEvent, { type: "charger.booted" }>;
        await this.db.charger.update({ where: { id: c.id }, data: { online: true, lastSeenAt: now, vendor: b.vendor, model: b.model, firmware: b.firmware ?? null } });
        break;
      }
      case "connector.status": {
        const s = e as Extract<GatewayEvent, { type: "connector.status" }>;
        await this.db.charger.update({ where: { id: c.id }, data: { online: true, lastSeenAt: now } });
        if (s.connectorId > 0) await this.db.connector.updateMany({ where: { chargerId: c.id, ocppId: s.connectorId }, data: { status: s.status } });
        break;
      }
      default:
        await this.db.charger.update({ where: { id: c.id }, data: { lastSeenAt: now } });
    }
    return { ok: true };
  }

  // ---------- Commands to a charger ----------

  async action(chargePointId: string, body: { action: string; connectorId?: number; idTag?: string; type?: string }) {
    const c = await this.charger(chargePointId);
    if (!this.isOnline(c)) throw new ServiceUnavailableException("The charger is offline");
    const connectorId = Number(body?.connectorId ?? 1);
    switch (body?.action) {
      case "reset":
        return this.gateway.call(c.chargePointId, "Reset", { type: body.type === "Hard" ? "Hard" : "Soft" });
      case "unlock":
        return this.gateway.call(c.chargePointId, "UnlockConnector", { connectorId });
      case "start":
        return this.gateway.call(c.chargePointId, "RemoteStartTransaction", { connectorId, idTag: body.idTag?.trim() || "EVGO-OPS" });
      case "stop": {
        const session = await this.db.chargingSession.findFirst({
          where: { chargerId: c.id, connectorOcppId: connectorId, status: "ACTIVE" },
          orderBy: { startedAt: "desc" },
        });
        // A session started from the app is known here; one started at the charger (card, console) only the gateway knows.
        return this.gateway.call(c.chargePointId, "RemoteStopTransaction", session ? { transactionId: session.ocppTransactionId } : { connectorId });
      }
      default:
        throw new BadRequestException("Action must be reset, unlock, start or stop");
    }
  }

  private async charger(chargePointId: string) {
    const c = await this.db.charger.findUnique({ where: { chargePointId } });
    if (!c) throw new NotFoundException("Charger not found");
    return c;
  }

  private isOnline(c: { online: boolean; lastSeenAt: Date | null }) {
    return c.online && !!c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < STALE_MS;
  }

  private present(r: StationRow) {
    return {
      id: r.id,
      name: r.place.name,
      city: r.place.city,
      lat: r.place.lat,
      lng: r.place.lng,
      access: r.access,
      operator: { id: r.org.id, name: r.org.name },
      chargers: r.chargers.map((c) => ({
        chargePointId: c.chargePointId,
        vendor: c.vendor,
        model: c.model,
        firmware: c.firmware,
        online: this.isOnline(c),
        lastSeenAt: c.lastSeenAt,
        hasPassword: !!c.ocppPasswordHash,
        ocppUrl: this.ocppUrl(c.chargePointId),
        connectors: c.connectors.map((k) => ({
          id: k.ocppId,
          type: k.type,
          label: CONNECTOR_TYPES[k.type]?.label ?? k.type,
          current: CONNECTOR_TYPES[k.type]?.current ?? "AC",
          powerKw: Number(k.maxPowerKw),
          pricePerKwhInr: k.tariff ? k.tariff.perKwhPaise / 100 : null,
          segments: k.segments.map((s) => SEGMENT_LABEL[s]),
          status: k.status,
        })),
      })),
    };
  }
}
