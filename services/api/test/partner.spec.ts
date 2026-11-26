import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { InventoryRegistry } from "../src/inventory/inventory.registry";
import { MockPartnerProvider } from "../src/inventory/mock-partner.provider";
import { parsePartnerTripId } from "../src/inventory/provider";
import { createApp, login, topUp } from "./helpers";

describe("Partner bus inventory", () => {
  let app: INestApplication;
  let tripId: string; // a partner trip more than 48 hours out
  let fare: number;
  let mock: MockPartnerProvider;

  beforeAll(async () => {
    app = await createApp();
    mock = app.get(InventoryRegistry).get("mock-partner") as MockPartnerProvider;
    const trips = (await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200)).body;
    const target = trips.find(
      (t: { provider: string; departsAt: string; busType: string }) =>
        t.provider === "mock-partner" && t.busType === "AC sleeper (partner)" && new Date(t.departsAt).getTime() - Date.now() > 72 * 3_600_000,
    );
    tripId = target.id;
    fare = target.fareInr * 100;
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("parses partner trip ids and leaves EVGO ids alone", () => {
    expect(parsePartnerTripId("p.mock-partner.SKT2100-2026-12-01")).toEqual({ providerId: "mock-partner", ref: "SKT2100-2026-12-01" });
    expect(parsePartnerTripId("3f2a9c1e-0000-4000-8000-000000000000")).toBeNull();
  });

  it("shows the partner's seat map and its own cancellation rules", async () => {
    const res = await request(http()).get(`/v1/trips/${tripId}/seats`).expect(200);
    expect(res.body.provider).toBe("mock-partner");
    expect(res.body.seats.length).toBe(30);
    expect(res.body.cancellationPolicy).toEqual([
      { minHoursBefore: 48, refundPercent: 100 },
      { minHoursBefore: 12, refundPercent: 75 },
    ]);
  });

  it("holds, pays from the wallet, issues the partner's PNR, lists it, and refunds on cancel", async () => {
    const token = await login(app);
    const hold = await request(http())
      .post("/v1/bookings")
      .set(as(token))
      .send({ tripId, seats: [{ seatLabel: "P1", passengerName: "Lakshmi" }, { seatLabel: "P2", passengerName: "Ravi" }] })
      .expect(201);
    expect(hold.body.totalPaise).toBe(2 * fare);

    const seats = (await request(http()).get(`/v1/trips/${tripId}/seats`).expect(200)).body.seats;
    expect(seats.find((s: { seatLabel: string }) => s.seatLabel === "P1").status).toBe("held");

    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(402);
    await topUp(app, token, 2 * fare);
    const paid = await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(201);
    expect(paid.body.pnr).toMatch(/^PNR/);
    expect(paid.body.tickets.map((t: { seatLabel: string }) => t.seatLabel).sort()).toEqual(["P1", "P2"]);
    expect(paid.body.balancePaise).toBe(0);

    const mine = (await request(http()).get("/v1/bookings").set(as(token)).expect(200)).body;
    expect(mine[0]).toMatchObject({ status: "PAID", provider: "mock-partner", pnr: paid.body.pnr, route: "Guntur to Hyderabad" });

    const cancel = await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(token)).expect(201);
    expect(cancel.body).toMatchObject({ refundPaise: 2 * fare, cancellationFeePaise: 0, balancePaise: 2 * fare }); // 100% at 48h+
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(token)).expect(409);
    const after = (await request(http()).get(`/v1/trips/${tripId}/seats`).expect(200)).body.seats;
    expect(after.find((s: { seatLabel: string }) => s.seatLabel === "P1").status).toBe("available");
  });

  it("does not let two customers hold the same partner seat", async () => {
    const [a, b] = [await login(app), await login(app)];
    await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "P5", passengerName: "A" }] }).expect(201);
    const clash = await request(http()).post("/v1/bookings").set(as(b)).send({ tripId, seats: [{ seatLabel: "P5", passengerName: "B" }] });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toBe("Seat P5 is not available");
  });

  it("returns the money to the wallet when the partner fails to confirm", async () => {
    const token = await login(app);
    await topUp(app, token, fare);
    const hold = await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "P9", passengerName: "Sita" }] }).expect(201);
    mock.failNextConfirm = true;
    const res = await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token));
    expect(res.status).toBe(502);
    expect(res.body.message).toBe("The bus company could not confirm your seats. Your money is back in your wallet");
    const wallet = (await request(http()).get("/v1/wallet").set(as(token)).expect(200)).body;
    expect(wallet.balancePaise).toBe(fare);
    expect((await request(http()).get("/v1/bookings").set(as(token)).expect(200)).body).toEqual([]);
  });

  it("releases a partner hold", async () => {
    const token = await login(app);
    const hold = await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "P12", passengerName: "Anil" }] }).expect(201);
    await request(http()).delete(`/v1/bookings/${hold.body.orderId}/hold`).set(as(token)).expect(200);
    const seats = (await request(http()).get(`/v1/trips/${tripId}/seats`).expect(200)).body.seats;
    expect(seats.find((s: { seatLabel: string }) => s.seatLabel === "P12").status).toBe("available");
  });

  it("returns 404 for a provider that is not switched on", () =>
    request(http()).get("/v1/trips/p.unknown-vendor.X1/seats").expect(404));
});
