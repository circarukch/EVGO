import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp } from "./helpers";

describe("Catalog", () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createApp()));
  afterAll(() => app.close());

  it("reports health", () => request(app.getHttpServer()).get("/v1/health").expect(200, { ok: true, service: "evgo-api" }));

  it("finds upcoming Guntur to Hyderabad trips with seats, fares and chargers at boarding", async () => {
    const res = await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200);
    const own = res.body.filter((t: { provider: string }) => t.provider === "evgo");
    expect(own.length).toBeGreaterThanOrEqual(40);
    const first = own[0];
    expect(first.from).toBe("Guntur EVGO Hub");
    expect(first.to).toBe("Hyderabad LB Nagar");
    expect(first.chargersAtBoarding).toBe(2); // the fleet-only depot charger is not counted
    expect(new Date(first.arrivesAt).getTime() - new Date(first.departsAt).getTime()).toBe(330 * 60_000);
  });

  it("supports boarding at an intermediate stop", async () => {
    const res = await request(app.getHttpServer()).get("/v1/trips?from=Vijayawada&to=Hyderabad").expect(200);
    expect(res.body[0].from).toBe("Vijayawada Benz Circle"); // the mock partner only runs Guntur to Hyderabad
  });

  it("lists partner trips alongside EVGO's own, in departure order", async () => {
    const res = await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200);
    const partner = res.body.filter((t: { provider: string }) => t.provider === "mock-partner");
    expect(partner.length).toBeGreaterThan(0);
    expect(partner[0]).toMatchObject({ electric: false, chargersAtBoarding: 0 });
    expect(partner[0].id).toMatch(/^p\.mock-partner\./);
    const times = res.body.map((t: { departsAt: string }) => new Date(t.departsAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("does not sell the reverse direction", async () => {
    const res = await request(app.getHttpServer()).get("/v1/trips?from=Hyderabad&to=Guntur").expect(200);
    expect(res.body).toEqual([]);
  });

  it("requires from and to for trip search", () => request(app.getHttpServer()).get("/v1/trips?from=Guntur").expect(400));

  it("filters chargers by vehicle segment and hides fleet-only depots", async () => {
    const twoWheeler = await request(app.getHttpServer()).get("/v1/chargers?segment=2w").expect(200);
    expect(twoWheeler.body.map((c: { id: string }) => c.id)).toEqual(["GNT-HUB-02"]);
    const bus = await request(app.getHttpServer()).get("/v1/chargers?segment=BUS").expect(200);
    expect(bus.body.map((c: { id: string }) => c.id)).toEqual(["SRY-PLZ-01"]);
    expect(bus.body[0]).toMatchObject({ operator: "Partner CPO", pricePerKwhInr: 21 });
  });

  it("returns 404 for an unknown charger", () => request(app.getHttpServer()).get("/v1/chargers/NOPE").expect(404));
});
