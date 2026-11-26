// Seed data for the Guntur to Hyderabad pilot corridor. Replaced by the
// database once the Bus and Charging modules are built. Coordinates approximate.
export interface Place {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  kinds: Array<"bus_stop" | "charging_site">;
}

export interface Charger {
  id: string;
  placeId: string;
  operator: string; // "EVGO" or a third-party CPO
  connectors: Array<{ id: number; type: "CCS2" | "Type2" | "GBT" | "LEV_AC" | "LECCS"; powerKw: number; status: string }>;
  segments: Array<"2W" | "3W" | "4W" | "BUS" | "TRUCK">;
  access: "public" | "fleet_only";
  pricePerKwhInr: number;
}

export interface Trip {
  id: string;
  operator: string;
  from: string; // Place id
  to: string;
  departs: string; // HH:mm local
  arrives: string;
  busType: "e-bus AC seater" | "e-bus AC sleeper";
  seatsLeft: number;
  fareInr: number;
}

export const places: Place[] = [
  { id: "gnt-hub", name: "Guntur EVGO Hub", city: "Guntur", lat: 16.3067, lng: 80.4365, kinds: ["bus_stop", "charging_site"] },
  { id: "vjw-stop", name: "Vijayawada Benz Circle", city: "Vijayawada", lat: 16.4985, lng: 80.6563, kinds: ["bus_stop"] },
  { id: "sry-plaza", name: "Suryapet Highway Plaza", city: "Suryapet", lat: 17.1405, lng: 79.6231, kinds: ["charging_site"] },
  { id: "hyd-lbn", name: "Hyderabad LB Nagar", city: "Hyderabad", lat: 17.3457, lng: 78.5522, kinds: ["bus_stop", "charging_site"] },
];

export const chargers: Charger[] = [
  { id: "GNT-HUB-01", placeId: "gnt-hub", operator: "EVGO", connectors: [{ id: 1, type: "CCS2", powerKw: 60, status: "Available" }, { id: 2, type: "Type2", powerKw: 22, status: "Charging" }], segments: ["4W"], access: "public", pricePerKwhInr: 18 },
  { id: "GNT-HUB-02", placeId: "gnt-hub", operator: "EVGO", connectors: [{ id: 1, type: "LEV_AC", powerKw: 3.3, status: "Available" }, { id: 2, type: "LECCS", powerKw: 12, status: "Available" }], segments: ["2W", "3W"], access: "public", pricePerKwhInr: 12 },
  { id: "GNT-DEPOT-01", placeId: "gnt-hub", operator: "EVGO", connectors: [{ id: 1, type: "CCS2", powerKw: 240, status: "Available" }], segments: ["BUS"], access: "fleet_only", pricePerKwhInr: 14 },
  { id: "SRY-PLZ-01", placeId: "sry-plaza", operator: "Partner CPO", connectors: [{ id: 1, type: "CCS2", powerKw: 120, status: "Available" }], segments: ["4W", "BUS", "TRUCK"], access: "public", pricePerKwhInr: 21 },
  { id: "HYD-LBN-01", placeId: "hyd-lbn", operator: "EVGO", connectors: [{ id: 1, type: "CCS2", powerKw: 60, status: "Faulted" }], segments: ["4W"], access: "public", pricePerKwhInr: 19 },
];

export const trips: Trip[] = [
  { id: "T-0600", operator: "EVGO", from: "gnt-hub", to: "hyd-lbn", departs: "06:00", arrives: "11:30", busType: "e-bus AC seater", seatsLeft: 23, fareInr: 549 },
  { id: "T-1400", operator: "EVGO", from: "gnt-hub", to: "hyd-lbn", departs: "14:00", arrives: "19:30", busType: "e-bus AC seater", seatsLeft: 8, fareInr: 599 },
  { id: "T-2230", operator: "Partner e-bus operator", from: "gnt-hub", to: "hyd-lbn", departs: "22:30", arrives: "04:30", busType: "e-bus AC sleeper", seatsLeft: 12, fareInr: 899 },
];
