const env = process.env.NODE_ENV ?? "development";

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (env === "production") throw new Error("JWT_SECRET must be set in production");
  return "dev-only-insecure-secret";
}

function adminApiKey(): string {
  const k = process.env.ADMIN_API_KEY;
  if (k) return k;
  if (env === "production") throw new Error("ADMIN_API_KEY must be set in production");
  return "dev-admin-key";
}

/** Partner bus inventory APIs to sell from, e.g. "mock-partner". The mock is on by default outside production only. */
function busInventoryProviders(): string[] {
  const raw = process.env.BUS_INVENTORY_PROVIDERS ?? (env === "production" ? "" : "mock-partner");
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (env === "production" && ids.includes("mock-partner")) throw new Error("The mock partner bus API cannot run in production");
  return ids;
}

export const config = {
  env,
  jwtSecret: jwtSecret(),
  adminApiKey: adminApiKey(),
  /** Return the OTP in the API response so the apps can log in without SMS. Never in production. */
  otpDevEcho: process.env.OTP_DEV_ECHO === "true" && env !== "production",
  /** Allow the mock payment gateway endpoint. Never in production. */
  mockPayments: env !== "production",
  busInventoryProviders: busInventoryProviders(),
  otpTtlSec: 300,
  otpMaxAttempts: 5,
  otpResendSec: 30,
  otpMaxPerHour: 5,
  seatHoldMinutes: 10,
  maxSeatsPerBooking: 6,
  topUpMinPaise: 100, // ₹1
  topUpMaxPaise: 10_000_000, // ₹1,00,000, the usual limit for a full-KYC prepaid wallet
};
