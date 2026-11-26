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
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis (not needed for the seed-data API yet)

pnpm --filter @evgo/api dev            # http://localhost:3001/v1/health
pnpm --filter @evgo/ocpp-gateway dev   # ws://localhost:9000/ocpp/<chargePointId>
pnpm --filter @evgo/ocpp-gateway simulate   # run a simulated charging session against the gateway
pnpm --filter @evgo/web dev            # http://localhost:3000
pnpm --filter @evgo/console dev        # http://localhost:3002

cd apps/mobile && flutter create --org in.evgo --project-name evgo --platforms=android,ios . && flutter run
```

Tests: `pnpm test` (gateway and API) and `cd apps/mobile && flutter test`.

## What works today (Phase 0 skeleton)

- OCPP 1.6J gateway: BootNotification, Heartbeat, StatusNotification, Authorize,
  Start/StopTransaction, MeterValues, plus remote commands to chargers; a charger
  simulator; tests for a full session, blocked cards and auth.
- API: health, bus trip search, and charger search by vehicle segment (2W, 3W, 4W,
  bus, truck) over Guntur to Hyderabad seed data; fleet-only depot chargers hidden.
- Data model for the whole MVP in `services/api/prisma/schema.prisma` (not yet migrated).
- Flutter app with the four tabs (Home, Travel, Charge, Wallet) calling the API.
- Web and console pages reading from the API.

Not yet built: login, booking and payments, wallet, database wiring, the event queue
between gateway and API. Those are Phase 1.
