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

Market-data persistence tests use independent Prisma clients and test-owned provider/symbol keys. They race quota reservations and refresh lease claims, verify exact snapshots and stale-worker fencing, preserve retry deadlines and stale data, and check wallet-subscription cascades without deleting shared quotes/work/counters. Deterministic calendar tests cover local midnight and daylight-saving boundaries. The default-provider-wiring historical API test owns and cleans the dedicated test database's `FMP` policy/counter rows; other provider tests use isolated keys or explicit controlled reservations. See [market-data persistence](market-data.md).

Scheduler unit tests verify symbol deduplication while queued, running and waiting for retry, concurrency limits, cache reuse and bounded backoff using fake timers. PostgreSQL scheduler tests use controlled FMP responses and real leases/counters to verify competing wallet refreshes dispatch only once, retries retain their charges, exhausted quota blocks dispatch, and old snapshots survive failures. Refresh ownership and persisted cooldowns are exercised at the service/database boundary; public wallet-open triggers arrive in 7D.

The scheduler integration suite also exercises the registered `server.priceRefresh` decorator with controlled provider dispatch, persistence and fresh-cache reuse. Error-path tests verify that failure-recording exceptions release queue entries and retain the original execution error when both operations fail. Type-contract tests exclude unrelated API failures and retryable quota/currency failures from refresh results.

To run frontend tests alone with bounded worker startup:

```sh
pnpm --filter @my-wallets/web exec vitest run --maxWorkers=1
```

`pnpm lint` checks source code against the configured rules; `pnpm test:eslint-rules` tests the custom rule implementations with valid and invalid code examples. The latter does not retest ESLint built-in rules.

## Browser journeys

Browser journey tests run in Chromium. The PostgreSQL purchase journey requires `NODE_ENV=test` and an explicit loopback `wallet_test` database URL, with migrations already applied. Without the test environment this one database journey is explicitly skipped; the other browser tests use controlled API responses.

The database journey forwards browser API requests to a real Fastify application, exercises registration, wallet creation, search, historical lookup, BUY, SELL, deletion cancellation, confirmed deletion, and corrected SELL re-entry. It verifies exact persisted decimals, FIFO results rendered in the browser, new transaction identity after correction, and four provider request reservations across the entire journey; SELL, deletion and ledger reads add none. Only FMP is replaced with a controlled fake. Test-owned users, wallets, transactions, and instruments are cleaned up.

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

## Contract ownership

Regenerate the [OpenAPI document and browser types](api.md#contracts-and-swagger) from the API schemas using `pnpm contracts:generate`; `pnpm contracts:check` fails if regeneration changes tracked contract artifacts. Keep financial and ownership guarantees covered at the API/database boundary, and user-visible navigation, cancellation, and form behavior covered through the router/browser.
