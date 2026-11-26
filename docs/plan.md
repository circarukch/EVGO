# EVGO plan

The full product and technical plan is maintained as a living document:
https://claude.ai/artifact/5r1APe66yT3f9SAs31E6Zx

Decisions so far:

- Market: India only (INR, UPI, GST, data hosted in India).
- One customer app for bus ticketing and EV charging, plus one operator console.
- Charging: EVGO-owned chargers and third-party CPOs, multi-tenant from day one.
- First bus segment: private electric bus operators, including EVGO's own e-bus fleet.
- Vehicle segments: 2W, 3W, 4W, buses and trucks.
- Pilot route: Guntur to Hyderabad.
- Stack: Flutter (iOS, Android), Next.js (web, console), NestJS + PostgreSQL/PostGIS
  (API), separate OCPP gateway (1.6J first, 2.0.1 next), Razorpay or Cashfree.
