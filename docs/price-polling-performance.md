# Price polling verification

This corrective change addresses F2 in the frontend review. Timed polling now requests refresh status only. A status query aggregates exact BUY-minus-SELL quantities inside PostgreSQL, scoped to the authenticated owner's wallet; it does not fetch the transaction ledger or replay FIFO accounting. A single database statement supplies a consistent ownership/quantity snapshot and retains closed positions.

The parameterized aggregate SQL is a deliberate repository choice. A Prisma `groupBy` alternative would need a separate ownership lookup to distinguish an empty wallet from a missing one, plus exact-decimal merging of BUY and SELL groups. Keeping those operations in one query avoids that extra coordination. `shouldReloadValuation` compares holdings by symbol rather than array order; its named conditions distinguish price changes and completed refresh work from ordinary pending/running progress.

The browser reloads valuation when a holding's freshness changes, a holding enters a terminal work state, the symbol set changes, or valuation is behind completed status. Pending-to-running progress alone does not reload financial values. Partial completion can therefore update values before all work finishes. Initial reads, explicit checks and refresh-action results still update pricing/quota. The shared quota controller retains its own interval.

Full pricing and status polling use separate fetchers. The full fetcher's URL remains unchanged, so a later sale/delete or explicit ledger recovery still revalidates financial values. Completed full reads retire earlier progress results to avoid stale progress overriding a newer snapshot. The existing pause limit, error feedback, cancellation and expired-session redirects remain in place.

## Local measurement

Measured on 2026-10-26 with the local PostgreSQL test database. The test created 10,000 BUY transactions for one instrument and sequentially executed five status reads followed by five full valuation reads through the real services/repositories. No provider requests were dispatched.

| Operation                            | Five reads, total | Mean per read |
| ------------------------------------ | ----------------: | ------------: |
| Quantity summary plus refresh status |         152.69 ms |      30.54 ms |
| Full ledger valuation                |       2,105.45 ms |     421.09 ms |

Status was about 13.8 times faster in this sample. This is a local observation, not a latency guarantee: hardware, caches, concurrent load, instrument count and SELL/FIFO history affect results. The status measurement ran first. The comparison isolates the service/database read path and does not measure browser rendering or HTTP overhead. Quantity aggregation still scans the wallet's relevant ledger rows in PostgreSQL; this change does not introduce materialized balances or indexes.

Twenty unchanged timed checks previously requested 60 API reads and initiated 40 FIFO replays. The new timed loop requests 20 status reads and no FIFO replays. Initial, explicit and terminal pricing reads, and the quota controller's separate interval, are outside that comparison.

Reproduce the measurement with PostgreSQL running and the existing local `wallet_test` schema prepared:

```powershell
pnpm --filter @my-wallets/api exec vitest run src/repositories/market-data-positions.integration.test.ts -t 'large ledger' --reporter=verbose
```

The fixture uses the repository's local test-server configuration and cleans up only its own users, wallets, instruments and ledger rows. No database reset or migration is required by this change. There is deliberately no timing threshold in the assertions.

## Regression coverage

- Service tests prove repeated status checks do not call accounting, quota reservation or the scheduler.
- PostgreSQL tests cover empty/missing/foreign wallets, cross-wallet isolation, exact residuals above JavaScript's safe integer range, and closed positions.
- Browser journeys cover unchanged pending/running progress on wallet and instrument pages, final valuation updates, bounded polling, partial-update decisions, quota cadence, and expired sessions during status-only polling.
- A sale after status-only polling verifies that normal financial mutation revalidation still updates the displayed valuation.

Engineering review covered responsibility boundaries, mutable state, request races, ownership, SQL parameterization and decimal precision. No dependencies or public contracts changed. Full valuation/accounting optimization and the other frontend review findings remain separate work.
