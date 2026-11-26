import { Injectable, NotFoundException } from "@nestjs/common";
import { ConnectorType, Prisma, VehicleSegment } from "@prisma/client";
import { istClock } from "../common/time";
import { PartnerBookingService } from "../booking/partner-booking.service";
import { PrismaService } from "../prisma/prisma.service";

const SEGMENTS: Record<string, VehicleSegment> = {
  "2W": "TWO_WHEELER",
  "3W": "THREE_WHEELER",
  "4W": "FOUR_WHEELER",
  BUS: "BUS",
  TRUCK: "TRUCK",
};
const SEGMENT_LABEL = Object.fromEntries(Object.entries(SEGMENTS).map(([k, v]) => [v, k])) as Record<VehicleSegment, string>;
const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  CCS2: "CCS2",
  TYPE2: "Type2",
  GBT: "GBT",
  BHARAT_DC001: "BharatDC001",
  LEV_AC: "LEV_AC",
  LECCS: "LECCS",
};

const chargerInclude = {
  site: { include: { place: true, org: true } },
  connectors: { include: { tariff: true }, orderBy: { ocppId: "asc" } },
} satisfies Prisma.ChargerInclude;
type ChargerRow = Prisma.ChargerGetPayload<{ include: typeof chargerInclude }>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: PrismaService,
    private readonly partners: PartnerBookingService,
  ) {}

  /** EVGO's own trips plus every switched-on partner's, in departure order. */
  async searchTrips(fromCity: string, toCity: string) {
    const [own, partner] = await Promise.all([this.searchOwnTrips(fromCity, toCity), this.partners.searchTrips(fromCity, toCity)]);
    return [...own, ...partner].sort((a, b) => a.departsAt.getTime() - b.departsAt.getTime());
  }

  private async searchOwnTrips(fromCity: string, toCity: string) {
    const now = new Date();
    const trips = await this.db.trip.findMany({
      where: { status: "scheduled", departsAt: { gt: now } },
      orderBy: { departsAt: "asc" },
      take: 200,
      include: {
        bus: { include: { layout: true } },
        inventory: true,
        schedule: { include: { route: { include: { org: true, stops: { include: { place: true }, orderBy: { sequence: "asc" } } } } } },
      },
    });
    const results = [];
    for (const t of trips) {
      const stops = t.schedule.route.stops;
      const from = stops.find((s) => s.boarding && s.place.city.toLowerCase() === fromCity.toLowerCase());
      const to = stops.find((s) => s.dropping && s.place.city.toLowerCase() === toCity.toLowerCase());
      if (!from || !to || from.sequence >= to.sequence) continue;
      const departsAt = new Date(t.departsAt.getTime() + from.offsetMinutes * 60_000);
      const arrivesAt = new Date(t.departsAt.getTime() + to.offsetMinutes * 60_000);
      const free = t.inventory.filter((s) => s.status === "available" || (s.status === "held" && s.heldUntil && s.heldUntil < now));
      const chargersAtBoarding = await this.db.charger.count({ where: { site: { placeId: from.placeId, access: "public" } } });
      results.push({
        id: t.id,
        provider: "evgo",
        operator: t.schedule.route.org.name,
        from: from.place.name,
        to: to.place.name,
        departsAt,
        arrivesAt,
        departs: istClock(departsAt),
        arrives: istClock(arrivesAt),
        busType: t.bus?.layout.name ?? "e-bus",
        electric: true as boolean | null,
        seatsLeft: free.length,
        fareInr: Math.min(...t.inventory.map((s) => s.farePaise)) / 100,
        chargersAtBoarding,
      });
    }
    return results;
  }

  /** Public chargers, optionally by vehicle segment and city. Fleet-only depot chargers are hidden. */
  async searchChargers(opts: { segment?: string; city?: string }) {
    const segment = opts.segment ? SEGMENTS[opts.segment.toUpperCase()] : undefined;
    if (opts.segment && !segment) return [];
    const rows = await this.db.charger.findMany({
      where: {
        site: { access: "public", ...(opts.city ? { place: { city: { equals: opts.city, mode: "insensitive" } } } : {}) },
        ...(segment ? { connectors: { some: { segments: { has: segment } } } } : {}),
      },
      include: chargerInclude,
      orderBy: { chargePointId: "asc" },
    });
    return rows.map((c) => this.present(c));
  }

  async getCharger(chargePointId: string) {
    const c = await this.db.charger.findUnique({ where: { chargePointId }, include: chargerInclude });
    if (!c) throw new NotFoundException(`Charger ${chargePointId} not found`);
    return this.present(c);
  }

  private present(c: ChargerRow) {
    const segments = [...new Set(c.connectors.flatMap((k) => k.segments))].map((s) => SEGMENT_LABEL[s]);
    const tariff = c.connectors.find((k) => k.tariff)?.tariff;
    return {
      id: c.chargePointId,
      operator: c.site.org.name,
      connectors: c.connectors.map((k) => ({ id: k.ocppId, type: CONNECTOR_LABEL[k.type], powerKw: Number(k.maxPowerKw), status: k.status })),
      segments,
      access: c.site.access,
      pricePerKwhInr: tariff ? tariff.perKwhPaise / 100 : null,
      place: { id: c.site.place.id, name: c.site.place.name, city: c.site.place.city, lat: c.site.place.lat, lng: c.site.place.lng },
    };
  }
}
