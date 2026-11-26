/**
 * SAMPLE charger catalogue for the "Need a charger?" shop. Names, prices and specs are
 * placeholders, not real offers: replace them from the operator console with real products.
 */
export const SAMPLE_CHARGERS = [
  {
    id: "smp-ac-3", name: "EVGO Home 3.3", brand: "EVGO (sample)", current: "AC", powerKw: 3.3, connectors: ["Type 2 socket"],
    priceInr: 18_000, warrantyYears: 2, installationIncluded: true, suitedFor: ["Home", "2W / 3W"],
    summary: "Wall box for scooters, three-wheelers and overnight car top-ups. Works on a normal 16 A home line.",
    specs: { Input: "230 V single phase, 16 A", Cable: "5 m tethered", Protection: "IP55, RCD type A", App: "Wi-Fi, schedule and lock", Standard: "IS 17017" },
  },
  {
    id: "smp-ac-7", name: "EVGO Home 7.4", brand: "EVGO (sample)", current: "AC", powerKw: 7.4, connectors: ["Type 2"],
    priceInr: 32_000, warrantyYears: 3, installationIncluded: true, suitedFor: ["Home", "Apartment", "4W"],
    summary: "The usual home charger for cars: a full charge overnight for most EVs.",
    specs: { Input: "230 V single phase, 32 A", Cable: "5 m tethered", Protection: "IP55, RCD type A, earth fault", App: "Wi-Fi + Bluetooth, RFID", Standard: "IS 17017, OCPP 1.6J" },
  },
  {
    id: "smp-ac-11", name: "EVGO Work 11", brand: "EVGO (sample)", current: "AC", powerKw: 11, connectors: ["Type 2"],
    priceInr: 52_000, warrantyYears: 3, installationIncluded: true, suitedFor: ["Apartment", "Office", "4W"],
    summary: "Three-phase charger for apartments and offices, with user cards and billing through EVGO.",
    specs: { Input: "415 V three phase, 16 A", Cable: "Socket (bring your cable) or 5 m tethered", Protection: "IP65, RCD type B", Network: "4G / Ethernet, OCPP 1.6J", Billing: "Per-user RFID and app" },
  },
  {
    id: "smp-ac-22", name: "EVGO Work 22 Twin", brand: "EVGO (sample)", current: "AC", powerKw: 22, connectors: ["Type 2", "Type 2"],
    priceInr: 95_000, warrantyYears: 3, installationIncluded: false, suitedFor: ["Office", "Shop", "Fleet depot"],
    summary: "Two 11 kW sockets, or one at 22 kW, for parking lots and small fleets. Listed on the EVGO app for paid public use.",
    specs: { Input: "415 V three phase, 32 A", Outputs: "2 × Type 2 socket, load sharing", Protection: "IP65, RCD type B", Network: "4G / Ethernet, OCPP 1.6J" },
  },
  {
    id: "smp-dc-30", name: "EVGO Fast 30", brand: "EVGO (sample)", current: "DC", powerKw: 30, connectors: ["CCS2"],
    priceInr: null, warrantyYears: 2, installationIncluded: false, suitedFor: ["Shop", "Office", "Fleet depot"],
    summary: "Compact wall-mount DC charger: about 80% in an hour for most cars.",
    specs: { Input: "415 V three phase, 63 A", Output: "200 to 1000 V DC, up to 100 A", Protection: "IP54", Network: "4G / Ethernet, OCPP 1.6J" },
  },
  {
    id: "smp-dc-60", name: "EVGO Fast 60", brand: "EVGO (sample)", current: "DC", powerKw: 60, connectors: ["CCS2", "Type 2 AC 22 kW"],
    priceInr: null, warrantyYears: 2, installationIncluded: false, suitedFor: ["Highway", "Shop", "Fleet depot"],
    summary: "Floor-standing DC charger with a 22 kW AC socket: the standard highway and mall unit.",
    specs: { Input: "415 V three phase, 125 A", Output: "CCS2 60 kW + AC 22 kW", Protection: "IP55", Screen: "7-inch, UPI QR on screen", Network: "4G / Ethernet, OCPP 1.6J" },
  },
  {
    id: "smp-dc-120", name: "EVGO Fast 120", brand: "EVGO (sample)", current: "DC", powerKw: 120, connectors: ["CCS2", "CCS2"],
    priceInr: null, warrantyYears: 2, installationIncluded: false, suitedFor: ["Highway", "Fleet depot"],
    summary: "Two CCS2 guns sharing 120 kW: highway stops and taxi fleets.",
    specs: { Input: "415 V three phase, 250 A", Output: "2 × CCS2, dynamic sharing", Protection: "IP55", Network: "4G / Ethernet, OCPP 1.6J" },
  },
  {
    id: "smp-dc-180", name: "EVGO Fast 180", brand: "EVGO (sample)", current: "DC", powerKw: 180, connectors: ["CCS2", "CCS2"],
    priceInr: null, warrantyYears: 2, installationIncluded: false, suitedFor: ["Highway", "Bus depot", "Truck"],
    summary: "High-power DC for highway plazas, buses and trucks.",
    specs: { Input: "HT supply / transformer", Output: "2 × CCS2, up to 1000 V", Cooling: "Liquid-cooled cables", Network: "4G / Ethernet, OCPP 1.6J" },
  },
  {
    id: "smp-dc-240", name: "EVGO Depot 240", brand: "EVGO (sample)", current: "DC", powerKw: 240, connectors: ["CCS2", "CCS2"],
    priceInr: null, warrantyYears: 2, installationIncluded: false, suitedFor: ["Bus depot", "Truck", "Fleet depot"],
    summary: "Built for e-bus depots: overnight and opportunity charging for 12 m buses.",
    specs: { Input: "HT supply / transformer", Output: "2 × CCS2, up to 1000 V, 500 A", Cooling: "Liquid-cooled cables", "Depot software": "Smart charging by bus schedule" },
  },
];
