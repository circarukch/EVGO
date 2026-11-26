// Seed data for the Guntur to Hyderabad pilot corridor. Safe to re-run: it wipes and reloads.
// Coordinates, fares and tariffs are placeholders for development.
import { ConnectorType, PrismaClient, VehicleSegment } from "@prisma/client";
import { istDate, istInstant } from "../src/common/time";

const db = new PrismaClient();
const DAYS_AHEAD = 14;

async function wipe() {
  // Child tables first.
  for (const t of [
    "CancellationPolicy", "LedgerEntry", "Hold", "TopUp", "Payment", "Booking", "ChargingSession", "OrderItem", "Order", "TripSeatInventory",
    "Trip", "Schedule", "Stop", "Route", "Bus", "Seat", "SeatLayout", "Alarm", "Connector", "Charger", "Tariff", "Site",
    "RfidToken", "OperatorUser", "Vehicle", "Passenger", "WalletAccount", "OtpChallenge", "User", "Organisation", "Place",
  ]) {
    await db.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
}

async function main() {
  await wipe();

  const evgo = await db.organisation.create({ data: { id: "org-evgo", name: "EVGO", kinds: ["PLATFORM", "CPO", "BUS_OPERATOR"] } });
  const partnerCpo = await db.organisation.create({ data: { id: "org-partner-cpo", name: "Partner CPO", kinds: ["CPO"], commissionBp: 1000 } });
  const partnerBus = await db.organisation.create({ data: { id: "org-partner-bus", name: "Partner e-bus operator", kinds: ["BUS_OPERATOR"], commissionBp: 1200 } });

  const place = (id: string, name: string, city: string, lat: number, lng: number, isStop: boolean, isSite: boolean) =>
    db.place.create({ data: { id, name, city, lat, lng, isStop, isSite } });
  const gnt = await place("gnt-hub", "Guntur EVGO Hub", "Guntur", 16.3067, 80.4365, true, true);
  const vjw = await place("vjw-stop", "Vijayawada Benz Circle", "Vijayawada", 16.4985, 80.6563, true, true);
  const sry = await place("sry-plaza", "Suryapet Highway Plaza", "Suryapet", 17.1405, 79.6231, false, true);
  const hyd = await place("hyd-lbn", "Hyderabad LB Nagar", "Hyderabad", 17.3457, 78.5522, true, true);

  // ---- Charging ----
  const tariff = (id: string, orgId: string, name: string, perKwhPaise: number) =>
    db.tariff.create({ data: { id, orgId, name, perKwhPaise, idleFeePerMinPaise: 200 } });
  const evgo4w = await tariff("tariff-evgo-4w", evgo.id, "EVGO public 4W", 1800);
  const evgoLev = await tariff("tariff-evgo-lev", evgo.id, "EVGO 2W/3W", 1200);
  const evgoDepot = await tariff("tariff-evgo-depot", evgo.id, "EVGO depot", 1400);
  const partnerHw = await tariff("tariff-partner-hw", partnerCpo.id, "Highway DC", 2100);

  const site = (id: string, orgId: string, placeId: string, name: string, access = "public") =>
    db.site.create({ data: { id, orgId, placeId, name, access } });
  await site("site-gnt-public", evgo.id, gnt.id, "Guntur hub public bay");
  await site("site-gnt-depot", evgo.id, gnt.id, "Guntur e-bus depot", "fleet_only");
  await site("site-sry", partnerCpo.id, sry.id, "Suryapet plaza");
  await site("site-hyd", evgo.id, hyd.id, "LB Nagar hub");
  await site("site-vjw", evgo.id, vjw.id, "Benz Circle bay");

  type C = { ocppId: number; type: ConnectorType; kw: number; segments: VehicleSegment[]; status: string; tariffId: string };
  const charger = (siteId: string, chargePointId: string, connectors: C[]) =>
    db.charger.create({
      data: {
        siteId,
        chargePointId,
        connectors: {
          create: connectors.map((c) => ({ ocppId: c.ocppId, type: c.type, maxPowerKw: c.kw, segments: c.segments, status: c.status, tariffId: c.tariffId })),
        },
      },
    });
  await charger("site-gnt-public", "GNT-HUB-01", [
    { ocppId: 1, type: "CCS2", kw: 60, segments: ["FOUR_WHEELER"], status: "Available", tariffId: evgo4w.id },
    { ocppId: 2, type: "TYPE2", kw: 22, segments: ["FOUR_WHEELER"], status: "Charging", tariffId: evgo4w.id },
  ]);
  await charger("site-gnt-public", "GNT-HUB-02", [
    { ocppId: 1, type: "LEV_AC", kw: 3.3, segments: ["TWO_WHEELER", "THREE_WHEELER"], status: "Available", tariffId: evgoLev.id },
    { ocppId: 2, type: "LECCS", kw: 12, segments: ["TWO_WHEELER", "THREE_WHEELER"], status: "Available", tariffId: evgoLev.id },
  ]);
  await charger("site-gnt-depot", "GNT-DEPOT-01", [
    { ocppId: 1, type: "CCS2", kw: 240, segments: ["BUS"], status: "Available", tariffId: evgoDepot.id },
  ]);
  await charger("site-sry", "SRY-PLZ-01", [
    { ocppId: 1, type: "CCS2", kw: 120, segments: ["FOUR_WHEELER", "BUS", "TRUCK"], status: "Available", tariffId: partnerHw.id },
  ]);
  await charger("site-hyd", "HYD-LBN-01", [
    { ocppId: 1, type: "CCS2", kw: 60, segments: ["FOUR_WHEELER"], status: "Faulted", tariffId: evgo4w.id },
  ]);

  await charger("site-vjw", "VJW-BNZ-01", [
    { ocppId: 1, type: "CCS2", kw: 60, segments: ["FOUR_WHEELER"], status: "Available", tariffId: evgo4w.id },
    { ocppId: 2, type: "CCS2", kw: 30, segments: ["FOUR_WHEELER"], status: "Available", tariffId: evgo4w.id },
  ]);

  // ---- Bus ----
  const seater = await db.seatLayout.create({
    data: { id: "layout-seater-40", name: "e-bus AC seater", seats: { create: Array.from({ length: 40 }, (_, i) => ({ label: `S${i + 1}`, kind: "seater" })) } },
  });
  const sleeper = await db.seatLayout.create({
    data: {
      id: "layout-sleeper-30",
      name: "e-bus AC sleeper",
      seats: { create: Array.from({ length: 30 }, (_, i) => ({ label: i < 15 ? `L${i + 1}` : `U${i - 14}`, kind: "sleeper", deck: i < 15 ? 1 : 2 })) },
    },
  });
  const bus1 = await db.bus.create({ data: { id: "bus-evgo-1", orgId: evgo.id, registration: "AP07 EV 0001", layoutId: seater.id } });
  const bus2 = await db.bus.create({ data: { id: "bus-evgo-2", orgId: evgo.id, registration: "AP07 EV 0002", layoutId: seater.id } });
  const bus3 = await db.bus.create({ data: { id: "bus-partner-1", orgId: partnerBus.id, registration: "TS09 EV 0101", layoutId: sleeper.id } });

  const route = async (id: string, orgId: string) =>
    db.route.create({
      data: {
        id,
        orgId,
        name: "Guntur to Hyderabad",
        stops: {
          create: [
            { placeId: gnt.id, sequence: 0, offsetMinutes: 0, boarding: true, dropping: false },
            { placeId: vjw.id, sequence: 1, offsetMinutes: 45, boarding: true, dropping: false },
            { placeId: hyd.id, sequence: 2, offsetMinutes: 330, boarding: false, dropping: true },
          ],
        },
      },
    });
  const evgoRoute = await route("route-evgo-gnt-hyd", evgo.id);
  const partnerRoute = await route("route-partner-gnt-hyd", partnerBus.id);

  const plans = [
    { routeId: evgoRoute.id, time: "06:00", busId: bus1.id, layout: seater.id, farePaise: 54900 },
    { routeId: evgoRoute.id, time: "14:00", busId: bus2.id, layout: seater.id, farePaise: 59900 },
    { routeId: partnerRoute.id, time: "22:30", busId: bus3.id, layout: sleeper.id, farePaise: 89900 },
  ];
  for (const p of plans) {
    const schedule = await db.schedule.create({ data: { routeId: p.routeId, departsTime: p.time, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } });
    const seats = await db.seat.findMany({ where: { layoutId: p.layout } });
    for (let d = 0; d <= DAYS_AHEAD; d++) {
      const trip = await db.trip.create({ data: { scheduleId: schedule.id, busId: p.busId, departsAt: istInstant(istDate(d), p.time) } });
      await db.tripSeatInventory.createMany({ data: seats.map((s) => ({ tripId: trip.id, seatLabel: s.label, farePaise: p.farePaise })) });
    }
  }
  console.log(`Seeded Guntur to Hyderabad: 4 places, 5 chargers, ${plans.length * (DAYS_AHEAD + 1)} trips`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
