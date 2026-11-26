# Partner bus inventory

EVGO sells two kinds of bus seats through the same app, wallet and API:

| | EVGO's own buses | Partner inventory |
|---|---|---|
| Seats and fares live in | EVGO's database | The partner's system, reached by its API |
| Trip id | uuid | `p.<provider>.<ref>` |
| Hold | Row lock in our DB, 10 min | Partner "block" call, partner's timeout |
| Pay | One DB transaction: wallet debit + seats booked | Wallet debit, then partner "confirm"; reversed automatically if confirm fails |
| Cancellation rules | Per operator, set in the console | The partner's own; we credit whatever refund it reports |
| Ledger account | `operator_payable:<org>` | `partner_payable:<provider>` |

## Adding a vendor

1. Write `src/inventory/<vendor>.provider.ts` implementing `BusInventoryProvider` (`provider.ts`):
   `searchTrips`, `seatMap`, `block`, `confirm`, `release`, `cancel`. Map the vendor's errors to `ProviderError` kinds.
2. Register it in `FACTORIES` in `inventory.registry.ts`.
3. Turn it on with `BUS_INVENTORY_PROVIDERS=<id>` (comma separated). Credentials go in env vars read by the adapter.

The apps need no change: partner trips arrive in `/v1/trips` with `provider` set to the vendor id.

## Mock partner

`mock-partner` is an in-memory pretend vendor (two night services a day, Guntur to Hyderabad, 7 days ahead,
100% refund at 48h+, 75% at 12h+). It is on by default outside production and refuses to start in production.

## Still to do when a real vendor is chosen

- Boarding and dropping points from the vendor's layout call.
- A reconciliation job for the rare case where the vendor confirms but our record write fails (and vice versa).
- Settlement with the vendor (prepaid balance or invoice) against `partner_payable:<provider>`.
- Vendor commission / markup and GST on the convenience fee.
