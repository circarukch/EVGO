// Station and charger shapes and choices, safe to use in the browser.
export type Plug = {
  id: number;
  type: string;
  label: string;
  current: "AC" | "DC";
  powerKw: number;
  pricePerKwhInr: number | null;
  segments: string[];
  status: string;
};
export type ChargerView = {
  chargePointId: string;
  vendor: string | null;
  model: string | null;
  firmware: string | null;
  online: boolean;
  lastSeenAt: string | null;
  hasPassword: boolean;
  ocppUrl: string;
  connectors: Plug[];
};
export type Station = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  access: string;
  operator: { id: string; name: string };
  chargers: ChargerView[];
};
/** What the installer types into the charger. The password is only ever shown once. */
export type Connection = { chargePointId: string; url: string; username: string; password: string; ocppVersion: string; securityProfile: number };

/** Plug types the API accepts, with whether they are AC or DC. */
export const PLUG_TYPES = [
  { value: "CCS2", label: "CCS2", current: "DC" },
  { value: "TYPE2", label: "Type 2", current: "AC" },
  { value: "GBT", label: "GB/T", current: "DC" },
  { value: "BHARAT_DC001", label: "Bharat DC-001", current: "DC" },
  { value: "LEV_AC", label: "LEV AC", current: "AC" },
  { value: "LECCS", label: "LECCS", current: "DC" },
] as const;
export const VEHICLES = ["2W", "3W", "4W", "BUS", "TRUCK"] as const;
