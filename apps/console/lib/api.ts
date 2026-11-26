import "server-only";

export const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

function adminKey(): string {
  const k = process.env.EVGO_ADMIN_API_KEY;
  if (k) return k;
  if (process.env.NODE_ENV === "production") throw new Error("EVGO_ADMIN_API_KEY must be set in production");
  return "dev-admin-key";
}

/** Server-side call to the admin API. The key never reaches the browser. */
export async function adminFetch(path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", "x-admin-key": adminKey(), ...(init.headers ?? {}) },
  });
}

export type RefundTier = { minHoursBefore: number; refundPercent: number };
export type Operator = { id: string; name: string; cancellationPolicy: { tiers: RefundTier[]; isDefault: boolean } };
