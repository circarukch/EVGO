import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { normalizeIndianMobile } from "../src/auth/phone";
import { createApp, db, newPhone } from "./helpers";

describe("normalizeIndianMobile", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["5876543210", null],
    ["98765", null],
  ])("%s -> %s", (input, out) => expect(normalizeIndianMobile(input)).toBe(out));
});

describe("Phone OTP login", () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createApp()));
  afterAll(() => app.close());
  const http = () => app.getHttpServer();

  it("rejects a number that is not an Indian mobile", () =>
    request(http()).post("/v1/auth/otp/request").send({ phone: "12345" }).expect(400));

  it("logs in with the right code, creates the user and wallet once", async () => {
    const phone = newPhone();
    const r = await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(200);
    expect(r.body.devCode).toMatch(/^\d{6}$/);
    const v = await request(http()).post("/v1/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
    expect(v.body.user.phone).toBe(`+91${phone}`);
    const me = await request(http()).get("/v1/me").set("Authorization", `Bearer ${v.body.accessToken}`).expect(200);
    expect(me.body.id).toBe(v.body.user.id);
    expect(await db(app).walletAccount.count({ where: { userId: v.body.user.id } })).toBe(1);
  });

  it("does not accept the same code twice", async () => {
    const phone = newPhone();
    const r = await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(200);
    await request(http()).post("/v1/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
    await request(http()).post("/v1/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(401);
  });

  it("rejects a wrong code and locks after 5 wrong attempts", async () => {
    const phone = newPhone();
    const r = await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(200);
    const wrong = r.body.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(http()).post("/v1/auth/otp/verify").send({ phone, code: wrong }).expect(401);
    const locked = await request(http()).post("/v1/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(401);
    expect(locked.body.message).toMatch(/Too many wrong attempts/);
  });

  it("throttles repeat code requests", async () => {
    const phone = newPhone();
    await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(200);
    await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(429);
  });

  it("stores only a hash of the code", async () => {
    const phone = newPhone();
    const r = await request(http()).post("/v1/auth/otp/request").send({ phone }).expect(200);
    const row = await db(app).otpChallenge.findFirstOrThrow({ where: { phone: `+91${phone}` } });
    expect(row.codeHash).not.toContain(r.body.devCode);
  });

  it("rejects requests without a valid token", async () => {
    await request(http()).get("/v1/me").expect(401);
    await request(http()).get("/v1/me").set("Authorization", "Bearer nope").expect(401);
  });
});
