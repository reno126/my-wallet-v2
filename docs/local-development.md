# Local development

[Project overview](../README.md)

Run the commands below from the workspace root. Configuration names and defaults are listed in [`.env.example`](../.env.example); runtime requirements and the pinned package manager are defined in [`package.json`](../package.json).

## Requirements and dependencies

Use a supported Node.js and pnpm version from the root [`package.json`](../package.json) (Node.js 22.22 or newer in the 22.x line, or 24 or newer), then install workspace dependencies:

```sh
pnpm install
```

## Environment files

Install and start Docker Desktop or Docker Engine with Compose. Create the ignored local environment files from the checked-in example:

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.example .env.ci.local
```

Keep `.env.local` on the `wallet_dev` database and edit `.env.ci.local` to set `NODE_ENV=test` and point `DATABASE_URL` at `wallet_test`. The example credentials are for loopback development only. Do not put production credentials in these files or commit them.

Set `BETTER_AUTH_SECRET` in the ignored `.env.local` file before starting the API. Generate a value with `openssl rand -base64 32` and keep it out of Git and chat. Google OAuth and FMP credentials are optional for the initial local setup; see [credentials and production configuration](security-and-deployment.md#runtime-configuration-and-credentials) and [provider availability](api.md#provider-availability).

For provider requests, apply the cache/quota migration and set the API-only FMP key locally. The development budget defaults to 250 requests per day with an America/New_York reset; see [market-data configuration](market-data.md#quota-configuration). Never paste credentials in chat.

Root `:local` scripts select environment files explicitly through `dotenv-cli`. The [Prisma CLI configuration](../apps/api/prisma.config.ts) also loads the root `.env.local` when it exists. Use explicit wrappers for test and hosted environments so the intended database and runtime settings are supplied.

## Start PostgreSQL

Start PostgreSQL and wait for its health check with:

```sh
pnpm db:up:local
pnpm db:wait:local
```

## Apply migrations and generate the client

For a fresh checkout, apply the checked-in migrations to the development database and generate Prisma Client before starting the app:

```sh
pnpm exec dotenv -e .env.local -- pnpm db:migrate:deploy
pnpm db:generate:local
```

When changing the schema, use `pnpm db:migrate:dev:local` to create/apply a development migration and generate the client. Test and hosted environments use the migration-deploy workflow with their own explicit environment. Never run development migration experiments against production data.

## Run the app

Start the web and API development servers with:

```sh
pnpm dev:local
```

Vite listens on `http://127.0.0.1:5173` and proxies `/api` requests to `http://127.0.0.1:3000`. The API defaults to development mode and loopback host `127.0.0.1`, port `3000`. See [API documentation](api.md#contracts-and-swagger) for Swagger UI and [testing](testing.md) for the CI environment.

## Prisma Studio

Open Prisma Studio against the local development database with:

```sh
pnpm db:studio:local
```

Studio can edit and delete records, so keep it on the local development database and do not expose it publicly.

## Database lifecycle and reset

The Compose service binds PostgreSQL to loopback and creates `wallet_dev` plus `wallet_test` on first initialization of its named volume. Initialization scripts run only when that volume is empty. `pnpm db:stop` stops PostgreSQL without removing data. `pnpm db:down` removes the container and network but preserves the named volume. `pnpm db:destroy-local-data` removes the volume and permanently deletes both local databases; use it only when you intend to discard all local database data. To clear only test objects, use `pnpm db:reset:test:local`; it refuses to run unless `.env.ci.local` explicitly sets `NODE_ENV=test` and points to the loopback `wallet_test` database. Never use production data for local development or tests.

For test-database migration and browser-test prerequisites, follow [testing](testing.md).
