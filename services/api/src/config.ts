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

/** "simulated" (dev, tests, demo) until the OCPP gateway link is built; never simulated in production. */
function chargerControl(): "simulated" | "gateway" {
  const v = process.env.CHARGER_CONTROL ?? (env === "production" ? "gateway" : "simulated");
  if (v === "simulated" && env === "production") throw new Error("Simulated chargers cannot run in production");
  return v === "simulated" ? "simulated" : "gateway";
}

type PaymentGatewayConfig =
  | { kind: "mock" }
  | { kind: "none" }
  | { kind: "cashfree"; appId: string; secretKey: string; baseUrl: string; apiVersion: string; notifyUrl?: string };

/** "mock" outside production; Cashfree once its keys are set; otherwise online payments are off. */
function paymentGateway(): PaymentGatewayConfig {
  const v = process.env.PAYMENT_GATEWAY ?? (env === "production" ? "cashfree" : "mock");
  if (v === "mock") {
    if (env === "production") throw new Error("The mock payment gateway cannot run in production");
    return { kind: "mock" };
  }
  if (v === "cashfree") {
    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    if (!appId || !secretKey) return { kind: "none" };
    return {
      kind: "cashfree",
      appId,
      secretKey,
      baseUrl: process.env.CASHFREE_BASE_URL ?? (env === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com"),
      apiVersion: process.env.CASHFREE_API_VERSION ?? "2025-01-01",
      // Where Cashfree sends payment and refund webhooks, e.g. https://api.evgo.in/v1/payments/cashfree/webhook
      notifyUrl: process.env.CASHFREE_NOTIFY_URL,
    };
  }
  return { kind: "none" };
}

function gatewayApiKey(): string {
  const k = process.env.GATEWAY_API_KEY;
  if (k) return k;
  if (env === "production") throw new Error("GATEWAY_API_KEY must be set in production");
  return "dev-gateway-key";
}

export const config = {
  env,
  jwtSecret: jwtSecret(),
  adminApiKey: adminApiKey(),
  /** Return the OTP in the API response so the apps can log in without SMS. Never in production. */
  otpDevEcho: process.env.OTP_DEV_ECHO === "true" && env !== "production",
  /** Allow the mock payment gateway endpoint. Never in production. */
  mockPayments: env !== "production",
  otpTtlSec: 300,
  otpMaxAttempts: 5,
  otpResendSec: 30,
  otpMaxPerHour: 5,
  seatHoldMinutes: 10,
  maxSeatsPerBooking: 6,
  chargerControl: chargerControl(),
  /** Simulated chargers run this many times faster than real time. */
  chargingSimSpeedup: Number(process.env.CHARGING_SIM_SPEEDUP ?? 1),
  /** Wallet balance needed to start a charging session (₹100). */
  chargingMinStartPaise: 10_000,
  /** Shared secret between this API and the OCPP gateway (both directions). */
  gatewayApiKey: gatewayApiKey(),
  /** Where the API sends commands for chargers (the gateway's control port). */
  ocppGatewayUrl: process.env.OCPP_GATEWAY_URL ?? "http://localhost:9000",
  /** The address installers type into the charger; the charge point ID is appended. */
  ocppPublicUrl: process.env.OCPP_PUBLIC_URL ?? (env === "production" ? "wss://ocpp.evgo.in/ocpp" : "ws://localhost:9000/ocpp"),
  paymentGateway: paymentGateway(),
  /** Largest UPI block for one charging session (₹10,000, the usual UPI block limit). */
  upiBlockMaxPaise: 1_000_000,
  /** Minutes the customer has to approve a block in their UPI app. */
  upiApproveMinutes: 5,
  /** Hours a charging block stays valid if never captured (the bank releases it after). */
  upiBlockValidHours: 24,
  topUpMinPaise: 100, // ₹1
  topUpMaxPaise: 10_000_000, // ₹1,00,000, the usual limit for a full-KYC prepaid wallet
};
