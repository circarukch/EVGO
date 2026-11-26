import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp, login, topUp } from "./helpers";

/** Two customers on the same server: each sees and touches only their own data. */
describe("Each customer sees only their own data", () => {
  let app: INestApplication;
  let tripId: string;
  beforeAll(async () => {
    app = await createApp();
    const trips = (await request(app.getHttpServer()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200)).body;
    tripId = trips.find((t: { departsAt: string; busType: string }) => t.busType === "e-bus AC seater" && new Date(t.departsAt).getTime() - Date.now() > 120 * 3_600_000).id;
  });
  afterAll(() => app.close());
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it("keeps wallet, trips, charging and payments apart", async () => {
    const a = await login(app);
    const b = await login(app);

    // A: money, a ticket, a finished charge, a pending top-up and checkout.
    await topUp(app, a, 100_000);
    const hold = await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "S38", passengerName: "Asha" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(as(a)).expect(201);
    const s = await request(http()).post("/v1/charging/sessions").set(as(a)).send({ chargePointId: "VJW-BNZ-01", connectorId: 2 }).expect(201);
    await request(http()).post(`/v1/charging/sessions/${s.body.id}/stop`).set(as(a)).expect(201);
    const t = await request(http()).post("/v1/wallet/topups").set(as(a)).send({ amountPaise: 5_000 }).expect(201);
    const hold2 = await request(http()).post("/v1/bookings").set(as(a)).send({ tripId, seats: [{ seatLabel: "S39", passengerName: "Asha" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold2.body.orderId}/checkout`).set(as(a)).expect(201);

    // A sees it all.
    expect((await request(http()).get("/v1/bookings").set(as(a)).expect(200)).body).toHaveLength(1);
    expect((await request(http()).get("/v1/charging/sessions").set(as(a)).expect(200)).body.sessions).toHaveLength(1);
    expect((await request(http()).get("/v1/wallet").set(as(a)).expect(200)).body.history.length).toBeGreaterThan(0);

    // B sees nothing of A's.
    expect((await request(http()).get("/v1/bookings").set(as(b)).expect(200)).body).toEqual([]);
    expect((await request(http()).get("/v1/charging/sessions").set(as(b)).expect(200)).body.sessions).toEqual([]);
    expect((await request(http()).get("/v1/charging/sessions/active").set(as(b)).expect(200)).body.session).toBeNull();
    expect((await request(http()).get("/v1/wallet").set(as(b)).expect(200)).body).toEqual({ balancePaise: 0, history: [] });

    // And cannot open, stop, pay for, check or cancel A's things by id.
    await request(http()).get(`/v1/charging/sessions/${s.body.id}`).set(as(b)).expect(403);
    await request(http()).post(`/v1/charging/sessions/${s.body.id}/stop`).set(as(b)).expect(403);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(as(b)).expect(403);
    await request(http()).post(`/v1/bookings/${hold2.body.orderId}/checkout`).set(as(b)).expect(403);
    await request(http()).post(`/v1/bookings/${hold2.body.orderId}/checkout/check`).set(as(b)).expect(403);
    await request(http()).post(`/v1/bookings/${hold2.body.orderId}/checkout/mock-pay`).set(as(b)).send({ method: "upi" }).expect(403);
    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/check`).set(as(b)).expect(403);
    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set(as(b)).expect(403);

    // A's data is untouched by B's attempts: the second booking is still waiting for A to pay.
    expect((await request(http()).get("/v1/bookings").set(as(a)).expect(200)).body.map((x: { status: string }) => x.status)).toEqual(["PAID"]);
    expect((await request(http()).post(`/v1/bookings/${hold2.body.orderId}/checkout/check`).set(as(a)).expect(201)).body.status).toBe("PENDING");
  });
});
