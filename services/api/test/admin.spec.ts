import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { validateTiers } from "../src/booking/cancellation";
import { createApp, login, topUp } from "./helpers";

const ADMIN = { "x-admin-key": "dev-admin-key" };

describe("validateTiers", () => {
  it("sorts tiers and rejects bad ones", () => {
    expect(validateTiers([{ minHoursBefore: 6, refundPercent: 50 }, { minHoursBefore: 24, refundPercent: 90 }])[0].minHoursBefore).toBe(24);
    expect(() => validateTiers([])).toThrow("between 1 and 6");
    expect(() => validateTiers([{ minHoursBefore: 24, refundPercent: 101 }])).toThrow("whole percent");
    expect(() => validateTiers([{ minHoursBefore: -1, refundPercent: 10 }])).toThrow("hours");
    expect(() => validateTiers([{ minHoursBefore: 24, refundPercent: 50 }, { minHoursBefore: 24, refundPercent: 40 }])).toThrow("same hours");
    expect(() => validateTiers([{ minHoursBefore: 24, refundPercent: 50 }, { minHoursBefore: 6, refundPercent: 80 }])).toThrow("must not grow");
  });
});

describe("Operator cancellation policy", () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createApp()));
  afterAll(async () => {
    await request(app.getHttpServer()).delete("/v1/admin/operators/org-evgo/cancellation-policy").set(ADMIN);
    await app.close();
  });
  const http = () => app.getHttpServer();

  it("needs the admin key", async () => {
    await request(http()).get("/v1/admin/operators").expect(401);
    await request(http()).get("/v1/admin/operators").set({ "x-admin-key": "wrong" }).expect(401);
  });

  it("lists bus operators with the default policy", async () => {
    const res = await request(http()).get("/v1/admin/operators").set(ADMIN).expect(200);
    expect(res.body.map((o: { id: string }) => o.id).sort()).toEqual(["org-evgo", "org-partner-bus"]);
    expect(res.body[0].cancellationPolicy.isDefault).toBe(true);
  });

  it("saves a new policy, shows it to customers, and refunds by it", async () => {
    await request(http())
      .put("/v1/admin/operators/org-evgo/cancellation-policy")
      .set(ADMIN)
      .send({ tiers: [{ minHoursBefore: 48, refundPercent: 100 }, { minHoursBefore: 12, refundPercent: 40 }] })
      .expect(200);

    const trips = (await request(http()).get("/v1/trips?from=Guntur&to=Hyderabad").expect(200)).body;
    const trip = trips.find(
      (t: { operator: string; departsAt: string }) => t.operator === "EVGO" && new Date(t.departsAt).getTime() - Date.now() > 72 * 3_600_000,
    );
    const seats = (await request(http()).get(`/v1/trips/${trip.id}/seats`).expect(200)).body;
    expect(seats.cancellationPolicy).toEqual([{ minHoursBefore: 48, refundPercent: 100 }, { minHoursBefore: 12, refundPercent: 40 }]);

    const token = await login(app);
    const auth = { Authorization: `Bearer ${token}` };
    const fare = trip.fareInr * 100;
    await topUp(app, token, fare);
    const hold = await request(http()).post("/v1/bookings").set(auth).send({ tripId: trip.id, seats: [{ seatLabel: "S38", passengerName: "R" }] }).expect(201);
    await request(http()).post(`/v1/bookings/${hold.body.orderId}/pay`).set(auth).expect(201);
    const c = await request(http()).post(`/v1/bookings/${hold.body.orderId}/cancel`).set(auth).expect(201);
    expect(c.body.refundPaise).toBe(fare);
  });

  it("rejects an invalid policy and leaves the saved one alone", async () => {
    await request(http())
      .put("/v1/admin/operators/org-evgo/cancellation-policy")
      .set(ADMIN)
      .send({ tiers: [{ minHoursBefore: 24, refundPercent: 150 }] })
      .expect(400);
    const res = await request(http()).get("/v1/admin/operators/org-evgo/cancellation-policy").set(ADMIN).expect(200);
    expect(res.body.tiers[0].refundPercent).toBe(100);
  });

  it("goes back to the default", async () => {
    const res = await request(http()).delete("/v1/admin/operators/org-evgo/cancellation-policy").set(ADMIN).expect(200);
    expect(res.body.isDefault).toBe(true);
  });

  it("404s for an unknown operator", () =>
    request(http())
      .put("/v1/admin/operators/nope/cancellation-policy")
      .set(ADMIN)
      .send({ tiers: [{ minHoursBefore: 24, refundPercent: 90 }] })
      .expect(404));
});
