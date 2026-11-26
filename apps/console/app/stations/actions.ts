"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminFetch, apiError, Connection } from "../../lib/api";

export type FormState = { error?: string; ok?: string; connection?: Connection };

export async function createStation(_prev: FormState, form: FormData): Promise<FormState> {
  const operator = String(form.get("operator") ?? "");
  const body = {
    name: String(form.get("name") ?? ""),
    city: String(form.get("city") ?? ""),
    lat: Number(form.get("lat")),
    lng: Number(form.get("lng")),
    access: String(form.get("access") ?? "public"),
    ...(operator === "__new" ? { newOperatorName: String(form.get("newOperatorName") ?? "") } : { orgId: operator }),
  };
  const res = await adminFetch("/admin/stations", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return { error: await apiError(res, "Could not add the station") };
  const station = await res.json();
  revalidatePath("/stations");
  redirect(`/stations/${station.id}`);
}

export async function addCharger(_prev: FormState, form: FormData): Promise<FormState> {
  const siteId = String(form.get("siteId"));
  const types = form.getAll("type").map(String);
  const kw = form.getAll("powerKw").map(String);
  const price = form.getAll("price").map(String);
  const connectors = types.map((type, i) => ({
    type,
    powerKw: Number(kw[i]),
    pricePerKwhInr: Number(price[i]),
    segments: form.getAll(`seg-${i}`).map(String),
  }));
  const res = await adminFetch(`/admin/stations/${encodeURIComponent(siteId)}/chargers`, {
    method: "POST",
    body: JSON.stringify({
      chargePointId: String(form.get("chargePointId") ?? ""),
      vendor: String(form.get("vendor") ?? ""),
      model: String(form.get("model") ?? ""),
      connectors,
    }),
  });
  if (!res.ok) return { error: await apiError(res, "Could not add the charger") };
  const { connection } = await res.json();
  revalidatePath(`/stations/${siteId}`);
  return { ok: "Charger added. Enter these details in the charger's settings.", connection };
}

export async function newPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const cp = String(form.get("chargePointId"));
  const res = await adminFetch(`/admin/chargers/${encodeURIComponent(cp)}/password`, { method: "POST" });
  if (!res.ok) return { error: await apiError(res, "Could not make a new password") };
  return { ok: "New password made. The old one no longer works.", connection: await res.json() };
}

const DONE: Record<string, string> = {
  reset: "Restart sent",
  unlock: "Unlock sent",
  start: "Start sent",
  stop: "Stop sent",
};

export async function chargerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const cp = String(form.get("chargePointId"));
  const action = String(form.get("action"));
  const res = await adminFetch(`/admin/chargers/${encodeURIComponent(cp)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, connectorId: Number(form.get("connectorId") ?? 1), type: String(form.get("type") ?? "Soft") }),
  });
  if (!res.ok) return { error: await apiError(res, "The charger did not take the command") };
  const answer = (await res.json()) as { status?: string };
  revalidatePath(`/stations/${String(form.get("siteId"))}`);
  const status = answer.status ?? "Sent";
  const accepted = status === "Accepted" || status === "Unlocked";
  return accepted ? { ok: `${DONE[action] ?? "Sent"}: the charger said ${status}.` } : { error: `The charger said ${status}.` };
}
