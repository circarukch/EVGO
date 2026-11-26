"use server";

import { redirect } from "next/navigation";
import { API, apiError } from "../../lib/api";
import { clearSession, setSession } from "../../lib/session";

export type LoginState = { error?: string; email?: string };

/** Only send people back to a page on this console. */
const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/");

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  let res: Response;
  try {
    res = await fetch(`${API}/admin/auth/login`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: "Could not reach the EVGO API. Try again in a minute.", email };
  }
  if (!res.ok) return { error: await apiError(res, "Could not sign in"), email };
  const { token, operator } = (await res.json()) as { token: string; operator: { mustChangePassword: boolean } };
  await setSession(token);
  redirect(operator.mustChangePassword ? "/account/password?first=1" : safeNext(String(form.get("next") ?? "/")));
}

export async function signOut() {
  await clearSession();
  redirect("/login");
}
