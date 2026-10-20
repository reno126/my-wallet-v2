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

To run frontend tests alone with bounded worker startup:

```sh
pnpm --filter @my-wallets/web exec vitest run --maxWorkers=1
```

`pnpm lint` checks source code against the configured rules; `pnpm test:eslint-rules` tests the custom rule implementations with valid and invalid code examples. The latter does not retest ESLint built-in rules.

## Browser journeys

Browser journey tests run in Chromium. The PostgreSQL purchase journey requires `NODE_ENV=test` and an explicit loopback `wallet_test` database URL, with migrations already applied. Without the test environment this one database journey is explicitly skipped; the other browser tests use controlled API responses.

The database journey forwards browser API requests to a real Fastify application, exercises registration, wallet creation, search, historical lookup, and BUY persistence, and verifies the saved date, exact decimals, and four provider request reservations. Only FMP is replaced with a controlled fake. Test-owned users, wallets, transactions, and instruments are cleaned up.

Install Chromium and run controlled browser checks:

```sh
pnpm --filter @my-wallets/e2e exec playwright install chromium
pnpm test:e2e
```

After preparing the test database, include the PostgreSQL purchase journey with:

```sh
pnpm exec dotenv -e .env.ci.local -- pnpm test:e2e
```

The browser suite covers authentication, wallet creation/deletion, purchase interactions, page-failure recovery, and responsive states. Provider behavior is controlled, so automated checks do not consume live FMP quota.

## Contract ownership

Regenerate the [OpenAPI document and browser types](api.md#contracts-and-swagger) from the API schemas using `pnpm contracts:generate`; `pnpm contracts:check` fails if regeneration changes tracked contract artifacts. Keep financial and ownership guarantees covered at the API/database boundary, and user-visible navigation, cancellation, and form behavior covered through the router/browser.
