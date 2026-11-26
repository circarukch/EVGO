import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { refundShare } from "../src/booking/cancellation";
import { createApp, db, login, topUp } from "./helpers";

describe("refundShare", () => {
  it("by default refunds 90% a day or more ahead, 50% from 6 to 24 hours, and closes after that", () => {
    expect(refundShare(72)).toBe(0.9);
    expect(refundShare(24)).toBe(0.9);
    expect(refundShare(12)).toBe(0.5);
    expect(refundShare(5.9)).toBeNull();
  });

  it("follows an operator's own tiers in any order", () => {
    const tiers = [{ minHoursBefore: 2, refundPercent: 25 }, { minHoursBefore: 48, refundPercent: 100 }];
    expect(refundShare(50, tiers)).toBe(1);
    expect(refundShare(10, tiers)).toBe(0.25);
    expect(refundShare(1, tiers)).toBeNull();
  });
});

describe("Bus booking", () => {
  let app: INestApplication;
  let tripId: string; // a 40-seater trip at least three days out
  let fare: number;

  beforeAll(async () => {
    app = await createApp();
    const trips = (await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200)).body;
    const target = trips.find(
      (t: { departsAt: string; busType: string }) =>
        t.busType === "e-bus AC seater" && new Date(t.departsAt).getTime() - Date.now() > 72 * 3_600_000,
    );
    tripId = target.id;
    fare = target.fareInr * 100;
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("holds seats, takes payment from the wallet and issues tickets", async () => {
    const token = await login(app);
    await topUp(app, token, 200000);

    const hold = await request(http())
      .post("/v1/bookings")
      .set(as(token))
      .send({ tripId, seats: [{ seatLabel: "S1", passengerName: "Priya" }, { seatLabel: "S2", passengerName: "Ravi" }] })
      .expect(201);
    expect(hold.body.totalPaise).toBe(2 * fare);

    const seats = (await request(http()).get(`/v1/trips/${tripId}/seats`).expect(200)).body.seats;
    expect(seats.find((s: { seatLabel: string }) => s.seatLabel === "S1").status).toBe("held");

    const paid = await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(201);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.tickets).toHaveLength(2);
    expect(paid.body.balancePaise).toBe(200000 - 2 * fare);

    const mine = (await request(http()).get("/v1/bookings").set(as(token)).expect(200)).body;
    expect(mine[0]).toMatchObject({ orderId: hold.body.orderId, status: "PAID", route: "Guntur to Hyderabad" });

    // Paying twice does nothing.
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(409);
  });

  it("does not let a second customer take a held or booked seat", async () => {
    const a = await login(app);
    const b = await login(app);
    await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "S5", passengerName: "A" }] }).expect(201);
    await request(http()).post("/v1/bookings").set(as(b)).send({ tripId, seats: [{ seatLabel: "S5", passengerName: "B" }] }).expect(409);
    // A failed multi-seat hold leaves no partial hold behind.
    await request(http()).post("/v1/bookings").set(as(b)).send({ tripId, seats: [{ seatLabel: "S6", passengerName: "B" }, { seatLabel: "S5", passengerName: "B" }] }).expect(409);
    const s6 = await db(app).tripSeatInventory.findUniqueOrThrow({ where: { tripId_seatLabel: { tripId, seatLabel: "S6" } } });
    expect(s6.status).toBe("available");
  });

  it("gives a seat to exactly one of two simultaneous customers", async () => {
    const [a, b] = await Promise.all([login(app), login(app)]);
    const results = await Promise.all(
      [a, b].map((t) => request(http()).post("/v1/bookings").set(as(t)).send({ tripId, seats: [{ seatLabel: "S9", passengerName: "X" }] })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("asks for more money when the wallet is short, and keeps the hold", async () => {
    const token = await login(app);
    const hold = await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "S12", passengerName: "Z" }] }).expect(201);
    const res = await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(402);
    expect(res.body.shortfallPaise).toBe(fare);
    await topUp(app, token, fare);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(201);
  });

  it("frees a seat when its hold expires, and refuses payment on the expired hold", async () => {
    const a = await login(app);
    const b = await login(app);
    await topUp(app, a, fare);
    const hold = await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "S15", passengerName: "A" }] }).expect(201);
    const past = new Date(Date.now() - 1000);
    await db(app).tripSeatInventory.updateMany({ where: { holdOrderId: hold.body.orderId }, data: { heldUntil: past } });
    await db(app).order.update({ where: { id: hold.body.orderId }, data: { expiresAt: past } });

    await request(http()).post("/v1/bookings").set(as(b)).send({ tripId, seats: [{ seatLabel: "S15", passengerName: "B" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(a)).expect(410);
  });

  it("releases an unpaid hold on request", async () => {
    const token = await login(app);
    const hold = await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "S20", passengerName: "Q" }] }).expect(201);
    await request(http()).delete(`/v1/bookings/${hold.body.orderId}/hold`).set(as(token)).expect(200);
    const s = await db(app).tripSeatInventory.findUniqueOrThrow({ where: { tripId_seatLabel: { tripId, seatLabel: "S20" } } });
    expect(s.status).toBe("available");
  });

  it("cancels a paid booking with a 90% refund to the wallet and frees the seat", async () => {
    const token = await login(app);
    await topUp(app, token, fare);
    const hold = await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "S30", passengerName: "C" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(token)).expect(201);

    const c = await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(token)).expect(201);
    expect(c.body.refundPaise).toBe(Math.floor(fare * 0.9));
    expect(c.body.balancePaise).toBe(Math.floor(fare * 0.9));
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(token)).expect(409);

    const s = await db(app).tripSeatInventory.findUniqueOrThrow({ where: { tripId_seatLabel: { tripId, seatLabel: "S30" } } });
    expect(s.status).toBe("available");
  });

  it("does not let one customer pay for or cancel another's booking", async () => {
    const a = await login(app);
    const b = await login(app);
    const hold = await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "S33", passengerName: "A" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(b)).expect(403);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(b)).expect(403);
  });

  it("validates seat requests", async () => {
    const token = await login(app);
    await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [] }).expect(400);
    await request(http()).post("/v1/bookings").set(as(token)).send({ tripId, seats: [{ seatLabel: "S40", passengerName: "" }] }).expect(400);
    await request(http())
      .post("/v1/bookings")
      .set(as(token))
      .send({ tripId, seats: [{ seatLabel: "S40", passengerName: "A" }, { seatLabel: "S40", passengerName: "B" }] })
      .expect(400);
    await request(http()).post("/v1/bookings").send({ tripId, seats: [{ seatLabel: "S40", passengerName: "A" }] }).expect(401);
  });
});
