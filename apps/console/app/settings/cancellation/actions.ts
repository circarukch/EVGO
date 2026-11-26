"use server";

import { revalidatePath } from "next/cache";
import { adminFetch, RefundTier } from "../../../lib/api";

export type SaveState = { ok?: string; error?: string };

export async function savePolicy(_prev: SaveState, form: FormData): Promise<SaveState> {
  const orgId = String(form.get("orgId"));
  const hours = form.getAll("minHoursBefore").map(String);
  const percents = form.getAll("refundPercent").map(String);
  const tiers: RefundTier[] = hours
    .map((h, i) => ({ h: h.trim(), p: (percents[i] ?? "").trim() }))
    .filter((t) => t.h !== "" || t.p !== "")
    .map((t) => ({ minHoursBefore: Number(t.h), refundPercent: Number(t.p) }));
  const res = await adminFetch(`/admin/operators/${encodeURIComponent(orgId)}/cancellation-policy`, {
    method: "PUT",
    body: JSON.stringify({ tiers }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: typeof body.message === "string" ? body.message : `Could not save (${res.status})` };
  }
  revalidatePath("/settings/cancellation");
  return { ok: "Saved. New bookings and cancellations use these rules now." };
}

export async function resetPolicy(_prev: SaveState, form: FormData): Promise<SaveState> {
  const orgId = String(form.get("orgId"));
  const res = await adminFetch(`/admin/operators/${encodeURIComponent(orgId)}/cancellation-policy`, { method: "DELETE" });
  if (!res.ok) return { error: `Could not reset (${res.status})` };
  revalidatePath("/settings/cancellation");
  return { ok: "Back to the EVGO default." };
}
