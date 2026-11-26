// Charger shop types and helpers. Browser-safe: no server-only imports here.

export type ChargerProduct = {
  id: string;
  name: string;
  brand: string;
  current: "AC" | "DC";
  powerKw: number;
  connectors: string[];
  priceInr: number | null;
  warrantyYears: number;
  installationIncluded: boolean;
  suitedFor: string[];
  summary: string;
  specs: Record<string, string>;
  isSample: boolean;
  active: boolean;
};

export type ChargerLead = {
  id: string;
  productId: string | null;
  productName: string | null;
  name: string;
  phone: string;
  city: string;
  siteType: string;
  quantity: number;
  notes: string | null;
  status: LeadStatus;
  createdAt: string;
};

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUOTED", "WON", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_LABEL: Record<LeadStatus, string> = { NEW: "New", CONTACTED: "Contacted", QUOTED: "Quote sent", WON: "Won", LOST: "Lost" };

export const SITE_TYPES = ["Home", "Apartment", "Office", "Shop", "Highway", "Fleet depot", "Bus depot", "Other"];

/** ₹1,23,456 */
export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** "Input: 230 V" lines <-> { Input: "230 V" } */
export const specsToText = (s: Record<string, string>) =>
  Object.entries(s)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
export function specsFromText(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(0, i).trim()) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
