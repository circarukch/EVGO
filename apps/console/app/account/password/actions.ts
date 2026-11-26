"use server";

import { redirect } from "next/navigation";
import { API, apiError } from "../../../lib/api";
import { sessionToken, setSession } from "../../../lib/session";

export type PasswordState = { error?: string };

export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const token = await sessionToken();
  if (!token) redirect("/login");
  const newPassword = String(form.get("newPassword") ?? "");
  if (newPassword !== String(form.get("confirm") ?? "")) return { error: "The two new passwords do not match" };
  const res = await fetch(`${API}/admin/auth/password`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: String(form.get("currentPassword") ?? ""), newPassword }),
  });
  if (res.status === 401) redirect("/login?expired=1");
  if (!res.ok) return { error: await apiError(res, "Could not change the password") };
  await setSession(((await res.json()) as { token: string }).token);
  redirect("/?password=1");
}
