# Testing

[Project overview](../README.md)

Run commands from the workspace root. Use the dedicated loopback `wallet_test` database and ignored `.env.ci.local`; see [local development](local-development.md#environment-files) for environment-file creation. Do not use production data for tests.

## Prepare the test database

Set `NODE_ENV=test` and an explicit local `wallet_test` `DATABASE_URL` in `.env.ci.local`, then start PostgreSQL and apply the checked-in migrations:

```sh
pnpm db:wait:local
pnpm exec dotenv -e .env.ci.local -- pnpm db:migrate:deploy
```

If a clean test database is needed, use `pnpm db:reset:test:local`. The guarded reset refuses to run unless the environment explicitly targets the loopback test database. It removes test data; development data is preserved. See [database lifecycle and reset](local-development.md#database-lifecycle-and-reset).

## Workspace checks

Run the configured local CI pipeline, which includes contract generation/drift checks, lint, formatting, typechecks, tests, custom lint-rule tests, database-safety tests, builds, and dependency audit:

```sh
pnpm ci:local
```

The commands composing this pipeline are defined in the root [`package.json`](../package.json), and hosted CI is configured in [`.github/workflows`](../.github/workflows). Agent verification and approval requirements are in [`AGENTS.md`](../AGENTS.md).

Contract tests run from `src`, and the contracts build excludes test files so compiled copies are not counted as additional tests. The API Vitest runner uses at most four workers to bound database and Fastify/Swagger initialization work when the workspace suites run together. Run checks that generate Prisma (typecheck, API tests, builds, and contract generation) sequentially to avoid concurrent writes to the generated client.

BUY/SELL/deletion integration tests use the real PostgreSQL test database and controlled provider responses. Concurrency tests hold a wallet lock, confirm competing writes are queued through PostgreSQL's blocking graph, then release the lock and verify commit/rollback outcomes. They cover competing oversells, valid concurrent sales, BUY/SELL serialization, both queue orders for create/delete races, duplicate deletion, reverse-order deletion, and wallet deletion. Ordering tests exercise transaction date, millisecond creation time, and UUID tie-breaks. Deletion tests verify no mutation on conflicts, rollback on replay failure, shared-data preservation, and correction through normal re-entry. If local concurrent checks cause server-startup timeouts, run the API suite on its own with one worker:

```sh
pnpm exec dotenv -e .env.ci.local -- pnpm --filter @my-wallets/api exec vitest run --maxWorkers=1
```

Apply migrations and generate Prisma/build contracts first when running Vitest directly rather than the package's `test` script.

Ledger read integration tests validate the actual OpenAPI response/status/media/header contract for history, wallet holdings and instrument summaries. They cover empty wallets, open/closed/reopened positions, exact products beyond JavaScript safe integers, repeating averages, date/time/ID ordering, latest-delete flags across pages, symbol filters, ownership, validation, rate limits and sanitized failures. A held, uncommitted deletion verifies that reads return the previous committed ledger without waiting for the wallet write lock; subsequent reads see the committed deletion. Deletion/re-entry tests verify the public read summaries and history rather than relying only on internal calculation results.

Market-data persistence tests use independent Prisma clients and test-owned provider/symbol keys. They race quota reservations and refresh lease claims, verify exact snapshots and stale-worker fencing, preserve retry deadlines and stale data, and check wallet-subscription cascades without deleting shared quotes/work/counters. Deterministic calendar tests cover local midnight and daylight-saving boundaries. The default-provider-wiring historical API test uses a controlled quota day and cleans only that day, preserving the shared `FMP` policy and other counters so concurrent quota-status reads remain isolated. Other provider tests use isolated keys or explicit controlled reservations. See [market-data persistence](market-data.md).

Scheduler unit tests verify symbol deduplication while queued, running and waiting for retry, concurrency limits, cache reuse and bounded backoff using fake timers. PostgreSQL scheduler tests use controlled FMP responses and real leases/counters to verify competing wallet refreshes dispatch only once, retries retain their charges, exhausted quota blocks dispatch, and old snapshots survive failures. Refresh ownership and persisted cooldowns are exercised at the service/database boundary; the public refresh POST provides the wallet-open trigger, with browser wiring in 7E.

The scheduler integration suite also exercises the registered `server.priceRefresh` decorator with controlled provider dispatch, persistence and fresh-cache reuse. Error-path tests verify that failure-recording exceptions release queue entries and retain the original execution error when both operations fail. Type-contract tests exclude unrelated API failures and retryable quota/currency failures from refresh results.

Recovery integration tests use independent clients and reconstructed schedulers against PostgreSQL. They preserve unexpired leases, race expired claims, fence late results, resume persisted retries without resetting their allowance, retain quota charges, skip terminal/orphan work and paginate unfinished intent. A real Fastify close verifies that queued work remains pending while active price persistence finishes before Prisma disconnects. Recovery and scheduler unit tests use fake timers for deadline cancellation and shutdown admission; signal tests cover one-time close and listener cleanup. API test servers and OpenAPI export explicitly disable automatic startup reconstruction; hook-wiring tests exercise enabled, disabled and missing-key behavior independently. Tests use controlled providers and owned fixture keys rather than live FMP requests.

Cached valuation unit tests cover exact products beyond safe integers, FIFO cost-based unrealized P/L, high-precision allocation, missing/stale data, timezone freshness and empty/closed positions. Public API tests validate actual OpenAPI responses for valuation, refresh receipts/status and quota; they cover a slow provider without blocking responses, competing wallet/symbol requests with durable quota and lease fencing, failure/cooldown retention, deletion recalculation, ownership, authentication, mutation origins, input validation, rate limits and sanitized errors. Current quotes and work states are batch-read from PostgreSQL; controlled FMP responses do not consume live quota.

To run frontend tests alone with bounded worker startup:

```sh
pnpm --filter @my-wallets/web exec vitest run --maxWorkers=1
```

`pnpm lint` checks source code against the configured rules; `pnpm test:eslint-rules` tests the custom rule implementations with valid and invalid code examples. The latter does not retest ESLint built-in rules.

## Browser journeys

Browser journey tests run in Chromium. The PostgreSQL purchase journey requires `NODE_ENV=test` and an explicit loopback `wallet_test` database URL, with migrations already applied. Without the test environment this one database journey is explicitly skipped; the other browser tests use controlled API responses.

The database journey forwards browser API requests to a real Fastify application, exercises registration, wallet creation, search, historical lookup, BUY, SELL, deletion cancellation, confirmed deletion, and corrected SELL re-entry. It verifies exact persisted decimals, FIFO results rendered in the browser, new transaction identity after correction, and five provider reservations: search, historical price, BUY verification, then the current-price profile and quote. A gated quote verifies that missing prices and ledger actions remain visible during refresh; the final budget unit can finish and yield a fresh persisted snapshot with an exhausted-budget notice. SELL, deletion and subsequent fresh-cache reads add no provider requests. Only FMP is replaced with a controlled fake. Test-owned users, wallets, transactions, instruments, snapshots and refresh work are cleaned up after draining the scheduler.

Install Chromium and run controlled browser checks:

```sh
pnpm --filter @my-wallets/e2e exec playwright install chromium
pnpm test:e2e
```

After preparing the test database, include the PostgreSQL purchase journey with:

```sh
pnpm exec dotenv -e .env.ci.local -- pnpm test:e2e
```

The browser suite covers authentication, wallet creation/deletion, purchase interactions, ledger history and summaries, sale validation, deletion confirmation/conflicts, page-failure recovery, and responsive states. Ledger viewport checks cover 320, 375, 768, 1024 and 1440 pixels, including full-viewport mobile dialogs, keyboard focus, long names, empty/closed positions, and recoverable load failures. Router component tests also cover sale-state isolation across wallet/instrument navigation, preserving form values through holding refreshes, and blocking uncertain sale/delete retries until a manual refresh. Provider behavior is controlled, so automated checks do not consume live FMP quota.

Pricing feedback checks also exercise initial loading status, busy refresh controls with retained cached values, keyboard operation and expanded state of quota details, and warnings that remain visible when those details are collapsed. The responsive journey verifies the quota reset time in its configured timezone while the browser uses another timezone.

## Contract ownership

Pricing route tests cover non-blocking loading, exact decimal formatting, fresh/stale/missing/closed holdings, exhausted or disabled providers, retained valuations after read failures, explicit recovery, bounded polling, navigation cleanup and expired sessions. Controlled browser checks cover freshness transitions, the last quota unit, exhausted stale values, unavailable pricing and quota recovery at the established phone/tablet/desktop widths, asserting no page overflow and saving screenshots. These checks exercise UI behavior; they do not replace the PostgreSQL lease/quota race tests.

Regenerate the [OpenAPI document and browser types](api.md#contracts-and-swagger) from the API schemas using `pnpm contracts:generate`; `pnpm contracts:check` fails if regeneration changes tracked contract artifacts. Keep financial and ownership guarantees covered at the API/database boundary, and user-visible navigation, cancellation, and form behavior covered through the router/browser.

Market-data fixtures compose the shared authenticated API and ledger fixtures directly, using injected fetch responses without starting an unused HTTP provider. The base API fixture owns shutdown and cleanup of test-owned users, symbols and provider keys. HTTP adapter tests add their controlled network provider separately. Injected budgets supply both reservation and read methods so refresh admission and the public quota endpoint report the same counters that outbound requests consume. Plugin composition tests exercise this shared budget, including exhausted startup recovery, without a reachable database; PostgreSQL route tests separately verify durable counters and rejection of exhausted refresh requests.
