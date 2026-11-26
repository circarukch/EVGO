"use server";

import { revalidatePath } from "next/cache";
import { adminFetch, apiError } from "../../../lib/api";

export type UserFormState = { error?: string; created?: { email: string; temporaryPassword: string } };

export async function addUser(_prev: UserFormState, form: FormData): Promise<UserFormState> {
  const role = String(form.get("role") ?? "station_operator");
  const res = await adminFetch("/admin/console-users", {
    method: "POST",
    body: JSON.stringify({
      email: String(form.get("email") ?? ""),
      name: String(form.get("name") ?? ""),
      role,
      ...(role === "station_operator" ? { orgId: String(form.get("orgId") ?? "") } : {}),
    }),
  });
  if (!res.ok) return { error: await apiError(res, "Could not add the user") };
  const body = (await res.json()) as { operator: { email: string }; temporaryPassword: string };
  revalidatePath("/settings/users");
  return { created: { email: body.operator.email, temporaryPassword: body.temporaryPassword } };
}

export type RowState = { error?: string; reset?: { email: string; temporaryPassword: string } };

export async function userAction(_prev: RowState, form: FormData): Promise<RowState> {
  const id = String(form.get("id"));
  const what = String(form.get("what"));
  const res =
    what === "reset"
      ? await adminFetch(`/admin/console-users/${encodeURIComponent(id)}/reset-password`, { method: "POST" })
      : await adminFetch(`/admin/console-users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ active: what === "on" }) });
  if (!res.ok) return { error: await apiError(res, "Could not update the user") };
  revalidatePath("/settings/users");
  if (what === "reset") {
    const body = (await res.json()) as { operator: { email: string }; temporaryPassword: string };
    return { reset: { email: body.operator.email, temporaryPassword: body.temporaryPassword } };
  }
  return {};
}
