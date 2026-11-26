import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { sessionToken } from "./session";

export const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

/**
 * Server-side call to the admin API as the signed-in console user (token in an httpOnly cookie, never sent to the browser).
 * Not signed in or session ended: goes to the sign-in page. Temporary password: goes to "choose a password".
 * Role not allowed: goes to the dashboard with a notice.
 */
export async function adminFetch(path: string, init: RequestInit = {}) {
  const token = await sessionToken();
  if (!token) redirect("/login");
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) redirect("/login?expired=1");
  if (res.status === 403) {
    const msg = String(((await res.clone().json().catch(() => ({}))) as { message?: unknown }).message ?? "");
    redirect(msg.includes("temporary password") ? "/account/password" : "/?denied=1");
  }
  return res;
}

/** For `.catch(orNull)`: a network failure becomes null, but sign-in redirects still happen. */
export function orNull(e: unknown): null {
  unstable_rethrow(e);
  return null;
}

export type RefundTier = { minHoursBefore: number; refundPercent: number };
export type Operator = { id: string; name: string; cancellationPolicy: { tiers: RefundTier[]; isDefault: boolean } };

export type { ChargerView, Connection, Plug, Station } from "./stations";

export async function apiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const m = (body as { message?: unknown }).message;
  return typeof m === "string" ? m : Array.isArray(m) ? m.join(", ") : `${fallback} (${res.status})`;
}
