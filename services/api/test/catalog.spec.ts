import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("EVGO API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(() => app.close());

  it("reports health", () => request(app.getHttpServer()).get("/v1/health").expect(200, { ok: true, service: "evgo-api" }));

  it("finds Guntur to Hyderabad trips with charger counts at boarding", async () => {
    const res = await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].chargersAtBoarding).toBe(2); // the fleet-only depot charger is not counted
  });

  it("requires from and to for trip search", () => request(app.getHttpServer()).get("/v1/trips?from=Guntur").expect(400));

  it("filters chargers by vehicle segment and hides fleet-only depots", async () => {
    const twoWheeler = await request(app.getHttpServer()).get("/v1/chargers?segment=2w").expect(200);
    expect(twoWheeler.body.map((c: { id: string }) => c.id)).toEqual(["GNT-HUB-02"]);
    const bus = await request(app.getHttpServer()).get("/v1/chargers?segment=BUS").expect(200);
    expect(bus.body.map((c: { id: string }) => c.id)).toEqual(["SRY-PLZ-01"]);
  });

  it("returns 404 for an unknown charger", () => request(app.getHttpServer()).get("/v1/chargers/NOPE").expect(404));
});
