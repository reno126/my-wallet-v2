# My Wallet

My Wallet is a pnpm workspace with a React single-page client, a Fastify API, and shared browser-safe contracts.

## Local setup

Use a supported Node.js and pnpm version from the root `package.json` (Node.js 22.22 or newer in the 22.x line, or 24 or newer), then install workspace dependencies:

```sh
pnpm install
```

Install and start Docker Desktop or Docker Engine with Compose. Create the ignored local environment files from the checked-in example:

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.example .env.ci.local
```

Keep `.env.local` on the `wallet_dev` database and edit `.env.ci.local` to set `NODE_ENV=test` and point `DATABASE_URL` at `wallet_test`. The example credentials are for loopback development only. Do not put production credentials in these files or commit them.

Start PostgreSQL and wait for its health check with:

```sh
pnpm db:up:local
pnpm db:wait:local
```

Start the web development server with:

```sh
pnpm dev:local
```

Vite listens on `http://127.0.0.1:5173`. The development server proxies `/api` requests to `http://127.0.0.1:3000`. `pnpm ci:local` loads `.env.ci.local` for local CI checks; package scripts themselves never load environment files implicitly.

Build the static web output with `pnpm --filter @my-wallets/web build`. `vite preview` is for local review only; production web hosting will serve the built output separately from the API.

The API validates runtime, listener, origin/proxy, rate-limit, database, and authentication settings at startup. It defaults to development mode, loopback host `127.0.0.1`, and port `3000`. Set `BETTER_AUTH_SECRET` in the ignored `.env.local` file for local API development; generate it with `openssl rand -base64 32`. Tests may omit it and use a test-only dummy secret. Production also requires explicit `BETTER_AUTH_URL` and exact `WEB_ORIGIN` values. Google OAuth credentials are API-only and are used when OAuth is implemented. `DATABASE_URL` is reserved for the API and Prisma; the browser uses relative `/api` requests by default. Never expose API secrets through `VITE_` variables.

## API security policies

The API applies an IP-based ceiling of 100 requests per 60 seconds by default, exempts health probes, and lowers the Better Auth catch-all ceiling to 60. Better Auth enables its own PostgreSQL-backed limiter in production, with a default of 100 requests per 60 seconds and a stricter 5-per-60-second rule for credential, password-reset, and email-verification endpoints. Limits are configurable through the validated `API_*` and `BETTER_AUTH_*RATE_LIMIT*` settings. Authenticated private route scopes add a separate 300-per-60-second user limit after session resolution. Fastify and Better Auth both use the IP Fastify resolves after applying `API_TRUSTED_PROXY_CIDRS`, and both group IPv6 addresses by `/64`.

Configure the ingress to overwrite forwarded client-IP headers, prevent direct public access to the API origin, and list only verified proxy IPs/CIDRs in `API_TRUSTED_PROXY_CIDRS`. Better Auth receives Fastify's resolved IP through an internal `x-real-ip` header; incoming client values for that header are replaced. Private API mutations require an exact `Origin`, or an exact trusted origin parsed from `Referer` only when `Origin` is absent. Safe `GET`, `HEAD`, and `OPTIONS` methods do not require origin evidence. Better Auth auth endpoints keep their built-in CSRF/origin protections.

The initial deployment supports one API process. Better Auth rate-limit counters use PostgreSQL. Before running multiple API replicas, configure shared Redis storage for Fastify's counters as well; do not rely on its process-local store across replicas. Verify at the ingress that spoofed forwarded headers cannot change a client's rate-limit bucket.

Better Auth exposes its public authentication handler under `/api/auth/*`, stores users and sessions in PostgreSQL, and currently enables email/password registration and login. The API provides a typed session lookup and authentication hook for later protected route groups; browser sign-in screens and Google OAuth are implemented in later Phase 3 slices.

## API documentation

With the API running locally, open Swagger UI at `http://127.0.0.1:3000/documentation/`. The page loads the registered API contract and can send requests to its `/api` endpoints. Swagger UI serves its scripts and styles from the API origin under a static Content Security Policy; keep inline scripts and styles disabled rather than weakening Helmet's policy.

The Compose service binds PostgreSQL to loopback and creates `wallet_dev` plus `wallet_test` on first initialization of its named volume. Initialization scripts run only when that volume is empty. `pnpm db:stop` stops PostgreSQL without removing data. `pnpm db:down` removes the container and network but preserves the named volume. `pnpm db:destroy-local-data` removes the volume and permanently deletes both local databases; use it only when you intend to discard all local database data. To clear only test objects, use `pnpm db:reset:test:local`; it refuses to run unless `.env.ci.local` explicitly sets `NODE_ENV=test` and points to the loopback `wallet_test` database. Never use production data for local development or tests.

## Route configuration

The web app uses React Router Data Mode. `src/app/router.tsx` owns the typed `RouteObject` tree, and `src/main.tsx` mounts its `RouterProvider`. Route components are ordinary modules imported directly by route objects; folders are not file-system routes. Use nested routes with layout components and `<Outlet />` when routes share a shell. Keep each route's component and any future loader, action, or error boundary with the route behavior it owns. Keep the router focused on route composition, use direct imports instead of convenience re-export files, and load or mutate server state through route data APIs that call the typed API client.
