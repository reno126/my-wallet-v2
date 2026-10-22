# Security and deployment

[Project overview](../README.md)

These notes describe current API protections and configuration. The canonical deployment topology, environment/secrets protocol, and release verification requirements remain in [the implementation plan](../IMPLEMENTATION_PLAN.md#production-deployment-topology). See [production-like deployment verification](deployment-preview.md) for the prepared hosting policy, local checks and outstanding hosted acceptance steps for slice 8B.

## Runtime configuration and credentials

The API validates runtime, listener, origin/proxy, rate-limit, database, and authentication settings at startup. It defaults to development mode, loopback host `127.0.0.1`, and port `3000`. Set `BETTER_AUTH_SECRET` in the ignored `.env.local` file for local API development; generate it with `openssl rand -base64 32`. Tests may omit it and use a test-only dummy secret. Production also requires explicit `BETTER_AUTH_URL` and exact `WEB_ORIGIN` values. Google OAuth credentials are API-only: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the ignored local environment file or API secret manager to enable Google sign-in. The callback URL is `${WEB_ORIGIN}/api/auth/callback/google`; register that exact browser-visible URL with Google. The web app uses the same-origin `/api` path by default. Never expose API secrets through `VITE_` variables.

Keep environment files ignored and use the API deployment secret manager for hosted credentials. Public browser configuration is limited to browser-safe values such as the API origin; private keys and database credentials must stay API-only. The [example environment](../.env.example) is the configuration reference, and [local development](local-development.md#environment-files) explains environment selection.

## Request limits, proxies, and mutation origin

The API applies an IP-based ceiling of 100 requests per 60 seconds by default, exempts health probes, and lowers the Better Auth catch-all ceiling to 60. Better Auth enables its own PostgreSQL-backed limiter in production, with a default of 100 requests per 60 seconds and a stricter 5-per-60-second rule for credential, password-reset, and email-verification endpoints. Limits are configurable through the validated `API_*` and `BETTER_AUTH_*RATE_LIMIT*` settings. Authenticated private route scopes add a separate 300-per-60-second user limit after session resolution. Fastify and Better Auth both use the IP Fastify resolves after applying `API_TRUSTED_PROXY_CIDRS`, and both group IPv6 addresses by `/64`.

Configure the ingress to overwrite forwarded client-IP headers, prevent direct public access to the API origin, and list only verified proxy IPs/CIDRs in `API_TRUSTED_PROXY_CIDRS`. Better Auth receives Fastify's resolved IP through an internal `x-real-ip` header; incoming client values for that header are replaced. Private API mutations require an exact `Origin`, or an exact trusted origin parsed from `Referer` only when `Origin` is absent. Safe `GET`, `HEAD`, and `OPTIONS` methods do not require origin evidence. Better Auth auth endpoints keep their built-in CSRF/origin protections.

The initial deployment supports one API process. Better Auth rate-limit counters use PostgreSQL. Before running multiple API replicas, configure shared Redis storage for Fastify's counters as well; do not rely on its process-local store across replicas. Verify at the ingress that spoofed forwarded headers cannot change a client's rate-limit bucket.

Better Auth exposes its public authentication handler under `/api/auth/*`, stores users and sessions in PostgreSQL, and supports email/password registration and login plus Google sign-in when its API credentials are configured. New passwords must be 8 to 128 characters. Session cookies are HttpOnly and SameSite=Lax, use Secure in production or when `API_HTTPS_ENABLED=true`, and remain host-only. The browser provides account registration, login, Google sign-in, session-aware redirects, and logout.

## Web and API hosting

Build the static web output with `pnpm --filter @my-wallets/web build`. `vite preview` is for local review only; production web hosting will serve the built output separately from the API.

Production hosting must follow the plan’s [deployment topology](../IMPLEMENTATION_PLAN.md#production-deployment-topology), including same-origin `/api` routing where applicable, SPA deep-link handling, trusted ingress boundaries, HTTPS/cookies, static-host CSP, and release checks. API Helmet headers do not configure the independently hosted SPA’s browser policy.

Swagger UI is served by the API with its own static Content Security Policy; keep inline scripts and styles disabled instead of weakening Helmet. See [contracts and Swagger](api.md#contracts-and-swagger).

## Shared infrastructure and provider work

Normal FMP dispatch uses durable shared PostgreSQL reservations and fails closed on budget/configuration errors. Production provider dispatch requires an explicit quota limit and IANA reset timezone; the approved operational limit is 250. Apply the cache/quota migration before enabling dispatch. Provider credentials and budget enforcement belong to the API; see [provider availability](api.md#provider-availability) and [the adapter boundary](architecture.md#fmp-provider-boundary). The internal refresh scheduler uses fenced leases, bounded concurrency (default 3, maximum 5) and at most two retries, charging every dispatched request. Startup restores subscribed unfinished intent within remaining quota; shutdown stops admission and drains active persistence before database close. Allow termination grace for active API requests, refresh attempts and database cleanup. Each background refresh may use two 10-second provider calls; a forced kill leaves pending work or a lease to recover after expiry. Browser triggers follow in 7D. See [market-data scheduling](market-data.md#recovery-and-shutdown) for policy changes, reset semantics and the required initial single-process deployment boundary.

For local database start/stop/reset commands and safeguards, see [database lifecycle and reset](local-development.md#database-lifecycle-and-reset).

## Phase 7 browser and dependency review

Browser price refreshes call only authenticated API routes. Every resource loader/action binds its request signal through the shared client, and API schemas validate returned values. Provider credentials, budget admission, exact calculations, leases, concurrency and bounded retries remain server-owned. The browser retains stale values with visible labels, does not treat missing prices as zero, and bounds automatic status polling. Quote/status/quota reads never dispatch provider requests. Mutations retain the server's origin and ownership checks.

The phase-boundary audit on 2026-10-21 found one high and two moderate Windows editor-launch advisories affecting Vite 8.3.2. Updating the web development/build dependency to the patched 8.3.3 release removed all reported findings; `pnpm audit --audit-level high` reports no known vulnerabilities. No additional UI dependencies were added.
