"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminFetch, apiError } from "../../lib/api";
import { specsFromText } from "../../lib/shop";

export type ProductFormState = { error?: string };

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function saveProduct(_prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  const id = String(form.get("id") ?? "");
  const price = String(form.get("priceInr") ?? "").replace(/[,₹\s]/g, "");
  const body = {
    name: String(form.get("name") ?? ""),
    brand: String(form.get("brand") ?? ""),
    current: String(form.get("current") ?? "AC"),
    powerKw: Number(form.get("powerKw")),
    connectors: list(form.get("connectors")),
    priceInr: price === "" ? null : Number(price),
    warrantyYears: Number(form.get("warrantyYears") ?? 0),
    installationIncluded: form.get("installationIncluded") === "on",
    suitedFor: form.getAll("suitedFor").map(String),
    summary: String(form.get("summary") ?? ""),
    specs: specsFromText(String(form.get("specs") ?? "")),
    active: form.get("active") === "on",
    isSample: form.get("isSample") === "on",
  };
  const res = await adminFetch(id ? `/admin/shop/products/${encodeURIComponent(id)}` : "/admin/shop/products", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: await apiError(res, "Could not save the product") };
  revalidatePath("/shop");
  redirect("/shop?saved=1");
}

export async function setLeadStatus(form: FormData) {
  const id = String(form.get("id"));
  await adminFetch(`/admin/shop/leads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: String(form.get("status")) }) });
  revalidatePath("/shop/leads");
}
