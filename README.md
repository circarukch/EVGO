# EVGO

One app for electric travel in India: book electric bus seats and find, book and pay
for EV chargers, with one login and one wallet. One operator console runs both the
charging network (EVGO-owned and third-party CPOs) and bus operations.

Pilot corridor: **Guntur to Hyderabad**.

Product and technical plan: see [docs/plan.md](docs/plan.md).

## Repository layout

| Path | What | Stack |
| --- | --- | --- |
| `apps/mobile` | Customer app for iOS and Android | Flutter |
| `apps/web` | Customer website (SEO route pages, booking) | Next.js |
| `apps/console` | Operator console (chargers, sessions, tariffs, routes, manifests) | Next.js |
| `services/api` | Core backend, modular monolith | NestJS, Prisma, PostgreSQL + PostGIS |
| `services/ocpp-gateway` | WebSocket server chargers connect to | Node.js, OCPP 1.6J |
| `packages/api-contract` | OpenAPI contract shared by all clients | OpenAPI 3.1 |
| `infra` | Local dev stack | Docker Compose: TimescaleDB/PostGIS, Redis |

## Getting started

Requirements: Node 22, pnpm 9, Docker, Flutter (stable).

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis
cp services/api/.env.example services/api/.env
pnpm --filter @evgo/api db:migrate     # create tables
pnpm --filter @evgo/api db:seed        # Guntur to Hyderabad trips and chargers (clears existing rows)

pnpm --filter @evgo/api dev            # http://localhost:3001/v1/health
pnpm --filter @evgo/ocpp-gateway dev   # ws://localhost:9000/ocpp/<chargePointId>
pnpm --filter @evgo/ocpp-gateway simulate   # run a simulated charging session against the gateway
pnpm --filter @evgo/web dev            # http://localhost:3000
pnpm --filter @evgo/console dev        # http://localhost:3002 (refund rules under Cancellation and refunds)

cd apps/mobile && flutter create --org in.evgo --project-name evgo --platforms=android,ios . && flutter run
```

Tests: `pnpm test` (gateway and API; the API tests need Postgres and use the `evgo_test`
database, or `TEST_DATABASE_URL`) and `cd apps/mobile && flutter test`.

Logging in during development: with `OTP_DEV_ECHO=true` the API returns the 6-digit code
in the response and the app shows it under the code field, so no SMS is needed. Adding
money uses a mock payment gateway outside production.

## Brand

Logo, icon and colours are in [docs/brand](docs/brand/README.md) and `packages/brand/brand.json`.

## Operator settings

Refund rules for cancellations are set per bus operator in the console
(Cancellation and refunds). Until operator accounts exist, the console server calls the
API's `/admin` routes with a shared key: set the same value as `ADMIN_API_KEY` on the API
and `EVGO_ADMIN_API_KEY` on the console (both default to `dev-admin-key` outside production).

## What works today

Phase 1 (login, booking, wallet):

- Phone OTP login: Indian mobile numbers, 6-digit code stored only as a hash, 5-minute
  expiry, 5 wrong attempts lock the code, 30-second resend throttle, 5 codes an hour.
  JWT access tokens. SMS goes through a pluggable sender (console in development).
- Wallet: double-entry ledger in Postgres, balance derived from ledger lines, top-ups
  credited once even if the gateway webhook repeats, row lock so two payments can't
  overspend. Mock gateway in development; Razorpay or Cashfree plugs in at the top-up step.
- Bus booking: seat map, 10-minute seat holds (one customer wins a contested seat),
  payment from the wallet with a clear shortfall when it is short, tickets, release of
  unpaid holds, cancellation with refund to wallet (90% at 24h+, 50% at 6 to 24h, closed
  under 6h, as a default until operators set their own).
- Trip and charger search now read from the database.
- Flutter: login, seat selection and payment (with "add the shortfall and pay"), trips on
  Home with cancel, wallet balance, add money and history.

Phase 0 skeleton:

- OCPP 1.6J gateway: BootNotification, Heartbeat, StatusNotification, Authorize,
  Start/StopTransaction, MeterValues, plus remote commands to chargers; a charger
  simulator; tests for a full session, blocked cards and auth.
- API: health, bus trip search, and charger search by vehicle segment (2W, 3W, 4W,
  bus, truck); fleet-only depot chargers hidden.
- Data model for the whole MVP in `services/api/prisma/schema.prisma`.
- Flutter app with the four tabs (Home, Travel, Charge, Wallet) calling the API.
- Web and console pages reading from the API.

Not yet built: real payment gateway (Razorpay or Cashfree) and its webhook signature check,
real SMS provider, token storage on the device, charging sessions paid from the wallet, the
event queue between the OCPP gateway and the API, operator console pages for bookings.
