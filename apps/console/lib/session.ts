import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";

/** The console sign-in lives in this httpOnly cookie; the browser's scripts cannot read it. */
export const SESSION_COOKIE = "evgo_console";
const TWELVE_HOURS = 12 * 60 * 60;

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Only from a server action or route handler. */
export async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TWELVE_HOURS,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export type ConsoleUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "station_operator";
  orgId: string | null;
  orgName: string | null;
  mustChangePassword: boolean;
};

const API = process.env.EVGO_API_URL ?? "http://localhost:3001/v1";

/** Who is signed in, or null. Asked once per request. */
export const currentUser = cache(async (): Promise<ConsoleUser | null> => {
  const token = await sessionToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/admin/auth/me`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as ConsoleUser) : null;
  } catch {
    return null;
  }
});

export const ROLE_LABEL: Record<ConsoleUser["role"], string> = { admin: "Admin", station_operator: "Station operator" };
