import "reflect-metadata";
import { randomInt } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix("v1");
  await app.init();
  return app;
}

const usedPhones = new Set<string>();
/** A fresh random valid Indian mobile number (test files share one database). */
export function newPhone(): string {
  for (;;) {
    const phone = String(9_000_000_000 + randomInt(0, 999_999_999));
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

/** Log in through the real OTP flow and return a bearer token. */
export async function login(app: INestApplication, phone = newPhone()): Promise<string> {
  const http = app.getHttpServer();
  const req = await request(http).post("/v1/auth/otp/request").send({ phone }).expect(200);
  const res = await request(http).post("/v1/auth/otp/verify").send({ phone, code: req.body.devCode }).expect(200);
  return res.body.accessToken;
}

export async function topUp(app: INestApplication, token: string, amountPaise: number) {
  const http = app.getHttpServer();
  const t = await request(http).post("/v1/wallet/topups").set("Authorization", `Bearer ${token}`).send({ amountPaise }).expect(201);
  await request(http).post(`/v1/wallet/topups/${t.body.topUpId}/mock-confirm`).set("Authorization", `Bearer ${token}`).expect(201);
}

export const db = (app: INestApplication) => app.get(PrismaService);
