import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp, db, login } from "./helpers";

describe("Wallet", () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createApp()));
  afterAll(() => app.close());
  const http = () => app.getHttpServer();

  it("starts empty, credits a confirmed top-up once, and keeps the ledger balanced", async () => {
    const token = await login(app);
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(http()).get("/v1/wallet").set(auth).expect(200)).body.balancePaise).toBe(0);

    const t = await request(http()).post("/v1/wallet/topups").set(auth).send({ amountPaise: 50000 }).expect(201);
    expect(t.body.status).toBe("PENDING");
    expect((await request(http()).get("/v1/wallet").set(auth).expect(200)).body.balancePaise).toBe(0);

    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set(auth).expect(201);
    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set(auth).expect(201); // webhook retry

    const w = await request(http()).get("/v1/wallet").set(auth).expect(200);
    expect(w.body.balancePaise).toBe(50000);
    expect(w.body.history).toHaveLength(1);

    const sums = await db(app).ledgerEntry.aggregate({ _sum: { debitPaise: true, creditPaise: true } });
    expect(sums._sum.debitPaise).toBe(sums._sum.creditPaise);
  });

  it("rejects top-ups outside the allowed range", async () => {
    const token = await login(app);
    const auth = { Authorization: `Bearer ${token}` };
    await request(http()).post("/v1/wallet/topups").set(auth).send({ amountPaise: 50 }).expect(400);
    await request(http()).post("/v1/wallet/topups").set(auth).send({ amountPaise: 10_000_001 }).expect(400);
    await request(http()).post("/v1/wallet/topups").set(auth).send({ amountPaise: 100.5 }).expect(400);
  });

  it("does not let one user confirm another user's top-up", async () => {
    const a = await login(app);
    const b = await login(app);
    const t = await request(http()).post("/v1/wallet/topups").set({ Authorization: `Bearer ${a}` }).send({ amountPaise: 1000 }).expect(201);
    await request(http()).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set({ Authorization: `Bearer ${b}` }).expect(403);
  });

  it("requires login", () => request(http()).get("/v1/wallet").expect(401));
});
