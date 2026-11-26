import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createApp, db, login } from "./helpers";

const ADMIN_KEY = { "x-admin-key": "dev-admin-key" };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("Console sign-in and roles", () => {
  let app: INestApplication;
  const http = () => app.getHttpServer();
  const tag = Date.now().toString(36);
  const opEmail = `op-${tag}@test.local`;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    const d = db(app);
    await d.operatorUser.deleteMany({ where: { email: { endsWith: "@test.local" } } });
    const sites = await d.site.findMany({ where: { name: { startsWith: "TST Op " } } });
    await d.site.deleteMany({ where: { id: { in: sites.map((s) => s.id) } } });
    await d.place.deleteMany({ where: { id: { in: sites.map((s) => s.placeId) } } });
    await app.close();
  });

  const signIn = async (email: string, password: string) =>
    (await request(http()).post("/v1/admin/auth/login").send({ email, password }).expect(200)).body as { token: string; operator: { role: string; mustChangePassword: boolean } };

  it("signs in the seeded admin, and refuses wrong passwords and other kinds of tokens", async () => {
    await request(http()).post("/v1/admin/auth/login").send({ email: "admin@evgo.local", password: "nope-nope-nope" }).expect(401);
    await request(http()).post("/v1/admin/auth/login").send({ email: "nobody@evgo.local", password: "evgo-admin-dev" }).expect(401);
    const { token, operator } = await signIn("ADMIN@evgo.local ", "evgo-admin-dev");
    expect(operator).toMatchObject({ role: "admin", mustChangePassword: false });
    expect((await request(http()).get("/v1/admin/auth/me").set(bearer(token)).expect(200)).body.email).toBe("admin@evgo.local");
    await request(http()).get("/v1/admin/shop/products").set(bearer(token)).expect(200);

    // No sign-in, a customer app token, or a console token in the customer app: all refused.
    await request(http()).get("/v1/admin/stations").expect(401);
    const customer = await login(app);
    await request(http()).get("/v1/admin/stations").set(bearer(customer)).expect(401);
    await request(http()).get("/v1/wallet").set(bearer(token)).expect(401);
  });

  it("admin adds a station operator who must change the temporary password, then sees only their own stations", async () => {
    const admin = (await signIn("admin@evgo.local", "evgo-admin-dev")).token;
    await request(http()).post("/v1/admin/console-users").set(bearer(admin)).send({ email: opEmail, name: "Op", role: "station_operator" }).expect(400);
    const made = (
      await request(http())
        .post("/v1/admin/console-users")
        .set(bearer(admin))
        .send({ email: opEmail, name: "Ravi Op", role: "station_operator", orgId: "org-partner-cpo" })
        .expect(201)
    ).body;
    expect(made.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
    await request(http()).post("/v1/admin/console-users").set(bearer(admin)).send({ email: opEmail, name: "Again", role: "admin" }).expect(409);

    const first = await signIn(opEmail, made.temporaryPassword);
    expect(first.operator.mustChangePassword).toBe(true);
    await request(http()).get("/v1/admin/stations").set(bearer(first.token)).expect(403);
    await request(http()).post("/v1/admin/auth/password").set(bearer(first.token)).send({ currentPassword: "wrong", newPassword: "a-long-new-password" }).expect(400);
    await request(http()).post("/v1/admin/auth/password").set(bearer(first.token)).send({ currentPassword: made.temporaryPassword, newPassword: "short" }).expect(400);
    const changed = (
      await request(http())
        .post("/v1/admin/auth/password")
        .set(bearer(first.token))
        .send({ currentPassword: made.temporaryPassword, newPassword: "partner-station-2026" })
        .expect(200)
    ).body;
    // The old sign-in ended with the password change.
    await request(http()).get("/v1/admin/auth/me").set(bearer(first.token)).expect(401);
    const op = changed.token as string;

    const mine = (await request(http()).get("/v1/admin/stations").set(bearer(op)).expect(200)).body as { id: string; operator: { id: string } }[];
    const all = (await request(http()).get("/v1/admin/stations").set(ADMIN_KEY).expect(200)).body as { id: string; operator: { id: string } }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((s) => s.operator.id === "org-partner-cpo")).toBe(true);
    const other = all.find((s) => s.operator.id !== "org-partner-cpo")!;
    await request(http()).get(`/v1/admin/stations/${other.id}`).set(bearer(op)).expect(404);
    await request(http()).get(`/v1/admin/stations/${mine[0].id}`).set(bearer(op)).expect(200);
    expect((await request(http()).get("/v1/admin/cpo-operators").set(bearer(op)).expect(200)).body).toEqual([{ id: "org-partner-cpo", name: "Partner CPO" }]);

    // A new station always goes to their own organisation.
    const st = (
      await request(http())
        .post("/v1/admin/stations")
        .set(bearer(op))
        .send({ name: "TST Op Station", city: "Guntur", lat: 16.3, lng: 80.45, orgId: "org-evgo", newOperatorName: "Sneaky" })
        .expect(201)
    ).body;
    expect(st.operator.id).toBe("org-partner-cpo");

    // Admin-only areas.
    for (const path of ["/v1/admin/shop/products", "/v1/admin/console-users", "/v1/admin/refunds", "/v1/admin/operators"]) {
      await request(http()).get(path).set(bearer(op)).expect(403);
    }
  });

  it("switching someone off or resetting their password ends their sign-in; the last admin stays", async () => {
    const admin = await signIn("admin@evgo.local", "evgo-admin-dev");
    const me = (await request(http()).get("/v1/admin/auth/me").set(bearer(admin.token)).expect(200)).body;
    await request(http()).put(`/v1/admin/console-users/${me.id}`).set(bearer(admin.token)).send({ active: false }).expect(400);

    const users = (await request(http()).get("/v1/admin/console-users").set(bearer(admin.token)).expect(200)).body as { id: string; email: string }[];
    const op = users.find((u) => u.email === opEmail)!;
    const opToken = (await signIn(opEmail, "partner-station-2026")).token;
    await request(http()).put(`/v1/admin/console-users/${op.id}`).set(bearer(admin.token)).send({ active: false }).expect(200);
    await request(http()).get("/v1/admin/stations").set(bearer(opToken)).expect(401);
    await request(http()).post("/v1/admin/auth/login").send({ email: opEmail, password: "partner-station-2026" }).expect(401);

    await request(http()).put(`/v1/admin/console-users/${op.id}`).set(bearer(admin.token)).send({ active: true }).expect(200);
    const reset = (await request(http()).post(`/v1/admin/console-users/${op.id}/reset-password`).set(bearer(admin.token)).expect(200)).body;
    await request(http()).post("/v1/admin/auth/login").send({ email: opEmail, password: "partner-station-2026" }).expect(401);
    expect((await signIn(opEmail, reset.temporaryPassword)).operator.mustChangePassword).toBe(true);

    // Demoting the only admin is refused (the admin key is not an account).
    const lone = (await request(http()).post("/v1/admin/console-users").set(ADMIN_KEY).send({ email: `a-${tag}@test.local`, name: "Second Admin", role: "admin" }).expect(201)).body;
    await request(http()).put(`/v1/admin/console-users/${lone.operator.id}`).set(ADMIN_KEY).send({ active: false }).expect(200);
    await request(http()).put(`/v1/admin/console-users/${me.id}`).set(ADMIN_KEY).send({ role: "station_operator", orgId: "org-partner-cpo" }).expect(400);
  });

  it("locks an account for 15 minutes after five wrong passwords", async () => {
    const email = `lock-${tag}@test.local`;
    const made = (await request(http()).post("/v1/admin/console-users").set(ADMIN_KEY).send({ email, name: "Lock Test", role: "admin" }).expect(201)).body;
    for (let i = 0; i < 5; i++) await request(http()).post("/v1/admin/auth/login").send({ email, password: "wrong-password" }).expect(401);
    const res = await request(http()).post("/v1/admin/auth/login").send({ email, password: made.temporaryPassword }).expect(401);
    expect(res.body.message).toContain("Too many wrong passwords");
    await request(http()).post(`/v1/admin/console-users/${made.operator.id}/reset-password`).set(ADMIN_KEY).expect(200);
  });
});
