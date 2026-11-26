import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp, db, login } from "./helpers";

const ADMIN = { "x-admin-key": "dev-admin-key" };

describe("Want a charger? shop", () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await db(app).chargerLead.deleteMany({ where: { name: { startsWith: "Test " } } });
    await db(app).chargerProduct.deleteMany({ where: { name: { startsWith: "TST " } } });
    await app.close();
  });

  it("lists the sample AC and DC chargers, smallest first, with filters", async () => {
    const all = (await request(http()).get("/v1/shop/chargers").expect(200)).body;
    const kw = (rows: { current: string; powerKw: number }[], c: string) => rows.filter((r) => r.current === c).map((r) => r.powerKw);
    expect(kw(all, "AC")).toEqual([3.3, 7.4, 11, 22]);
    expect(kw(all, "DC")).toEqual([30, 60, 120, 180, 240]);
    expect(all.every((r: { isSample: boolean }) => r.isSample)).toBe(true);

    const dc = (await request(http()).get("/v1/shop/chargers?current=dc&minKw=100").expect(200)).body;
    expect(dc.map((r: { powerKw: number }) => r.powerKw)).toEqual([120, 180, 240]);
    const small = (await request(http()).get("/v1/shop/chargers?current=AC&maxKw=7.4").expect(200)).body;
    expect(small.map((r: { powerKw: number }) => r.powerKw)).toEqual([3.3, 7.4]);
    await request(http()).get("/v1/shop/chargers?current=XY").expect(400);

    const one = (await request(http()).get("/v1/shop/chargers/smp-ac-7").expect(200)).body;
    expect(one).toMatchObject({ name: "EVGO Home 7.4", connectors: ["Type 2"], priceInr: 32000, warrantyYears: 3, installationIncluded: true });
    expect(one.specs.Input).toContain("230 V");
    await request(http()).get("/v1/shop/chargers/nope").expect(404);
  });

  it("takes a quote request from a logged-in customer and shows it to them only", async () => {
    const lead = { productId: "smp-dc-60", name: "Test Ravi", phone: "+91 98480 12345", city: "Guntur", siteType: "Highway", quantity: 2, notes: "Dhaba on NH65" };
    await request(http()).post("/v1/shop/leads").send(lead).expect(401);
    const a = await login(app);
    const b = await login(app);
    const res = (await request(http()).post("/v1/shop/leads").set(as(a)).send(lead).expect(201)).body;
    expect(res).toMatchObject({ productName: "EVGO Fast 60", phone: "9848012345", status: "NEW", quantity: 2 });

    const general = { name: "Test Ravi", phone: "9848012345", city: "Guntur", siteType: "Home" };
    await request(http()).post("/v1/shop/leads").set(as(a)).send(general).expect(201);

    expect((await request(http()).get("/v1/shop/leads/mine").set(as(a)).expect(200)).body).toHaveLength(2);
    expect((await request(http()).get("/v1/shop/leads/mine").set(as(b)).expect(200)).body).toHaveLength(0);

    for (const bad of [{ name: "" }, { phone: "12345" }, { city: "" }, { siteType: "Moon" }, { quantity: 0 }, { productId: "nope" }]) {
      await request(http()).post("/v1/shop/leads").set(as(a)).send({ ...general, ...bad }).expect((r) => expect([400, 404]).toContain(r.status));
    }
  });

  it("lets the operator console manage products and enquiries", async () => {
    await request(http()).get("/v1/admin/shop/leads").expect(401);
    const created = (
      await request(http())
        .post("/v1/admin/shop/products")
        .set(ADMIN)
        .send({ name: "TST Wall 7", brand: "Acme", current: "AC", powerKw: 7.2, connectors: ["Type 2"], priceInr: 29999, summary: "Test", specs: { Input: "230 V" } })
        .expect(201)
    ).body;
    expect(created).toMatchObject({ isSample: false, active: true, powerKw: 7.2 });
    await request(http()).post("/v1/admin/shop/products").set(ADMIN).send({ name: "TST bad", current: "AC", summary: "x" }).expect(400);
    await request(http()).post("/v1/admin/shop/products").set(ADMIN).send({ name: "TST bad", current: "XX", powerKw: 7, summary: "x" }).expect(400);

    // Hide it: gone from the app, still in the console.
    await request(http()).put(`/v1/admin/shop/products/${created.id}`).set(ADMIN).send({ active: false, priceInr: null }).expect(200);
    await request(http()).get(`/v1/shop/chargers/${created.id}`).expect(404);
    const consoleRow = (await request(http()).get(`/v1/admin/shop/products/${created.id}`).set(ADMIN).expect(200)).body;
    expect(consoleRow).toMatchObject({ active: false, priceInr: null });

    const leads = (await request(http()).get("/v1/admin/shop/leads?status=NEW").set(ADMIN).expect(200)).body;
    const mine = leads.find((l: { name: string }) => l.name === "Test Ravi");
    expect(mine).toBeTruthy();
    const moved = (await request(http()).patch(`/v1/admin/shop/leads/${mine.id}`).set(ADMIN).send({ status: "contacted" }).expect(200)).body;
    expect(moved.status).toBe("CONTACTED");
    await request(http()).patch(`/v1/admin/shop/leads/${mine.id}`).set(ADMIN).send({ status: "MAYBE" }).expect(400);
  });
});
