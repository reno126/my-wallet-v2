# My Wallet

My Wallet is an application for managing separate USD investment wallets and recording stock purchases. It uses a TypeScript/pnpm workspace with a React SPA, React Router, a Fastify API, PostgreSQL/Prisma, and shared Zod/OpenAPI contracts.

## Development status

Authentication, wallet lifecycle, instrument search, historical quotes, the BUY ledger/purchase flow, and the pure FIFO accounting core are implemented. Normal provider dispatch currently returns an unavailable state until the durable shared quota store is connected; see [provider availability](docs/api.md#provider-availability). SELL persistence, accounting/history endpoints and UI, and valuation/refresh features follow the [implementation plan](IMPLEMENTATION_PLAN.md#delivery-slice-map).

## Quick start

Use the Node.js and pnpm versions specified in [`package.json`](package.json), and start Docker with Compose support. Run commands from the workspace root.

```powershell
pnpm install
Copy-Item .env.example .env.local
Copy-Item .env.example .env.ci.local
```

Before continuing, [configure the local environment files](docs/local-development.md#environment-files): set `BETTER_AUTH_SECRET` in `.env.local`, keep development on `wallet_dev`, and set `.env.ci.local` to `NODE_ENV=test` with `wallet_test`. Keep secrets out of Git and chat.

```sh
pnpm db:wait:local
pnpm exec dotenv -e .env.local -- pnpm db:migrate:deploy
pnpm db:generate:local
pnpm dev:local
```

Open [the app](http://127.0.0.1:5173). The API listens on `http://127.0.0.1:3000`; Vite proxies `/api` requests. Full setup, optional OAuth configuration, and database lifecycle commands are in [local development](docs/local-development.md).

## Documentation

- [Local development](docs/local-development.md) — environment files, PostgreSQL, migrations, Prisma Studio, and reset safeguards.
- [Architecture](docs/architecture.md) — workspace boundaries, provider accounting, ledger invariants, routing, cancellation, and UI flows.
- [Accounting](docs/accounting.md) — FIFO replay, remaining acquisition cost, decimal precision, and presentation rounding.
- [API behavior](docs/api.md) — OpenAPI/Swagger links, endpoint semantics, provider limitations, and request costs.
- [Testing](docs/testing.md) — local CI, contract checks, database tests, and browser journeys.
- [Security and deployment](docs/security-and-deployment.md) — credentials, cookies, request limits, trusted proxies, and hosting requirements.
- [Implementation plan](IMPLEMENTATION_PLAN.md) — canonical requirements and delivery order.
- [Agent instructions](AGENTS.md) — engineering review, verification, and approval workflow.
- [Dependency versions](DEPENDENCY_VERSIONS.md) — dependency version and compatibility decisions.

Endpoint contracts are authoritative in the [generated OpenAPI document](packages/contracts/openapi.json); documentation explains the implemented behavior, while the implementation plan defines planned work.
