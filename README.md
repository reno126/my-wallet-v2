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

Open Prisma Studio against the local development database with:

```sh
pnpm db:studio:local
```

Studio can edit and delete records, so keep it on the local development database and do not expose it publicly.

Start the web development server with:

```sh
pnpm dev:local
```

Vite listens on `http://127.0.0.1:5173`. The development server proxies `/api` requests to `http://127.0.0.1:3000`. `pnpm ci:local` loads `.env.ci.local` for local CI checks; package scripts themselves never load environment files implicitly.

Build the static web output with `pnpm --filter @my-wallets/web build`. `vite preview` is for local review only; production web hosting will serve the built output separately from the API.

The API validates runtime, listener, origin/proxy, rate-limit, database, and authentication settings at startup. It defaults to development mode, loopback host `127.0.0.1`, and port `3000`. Set `BETTER_AUTH_SECRET` in the ignored `.env.local` file for local API development; generate it with `openssl rand -base64 32`. Tests may omit it and use a test-only dummy secret. Production also requires explicit `BETTER_AUTH_URL` and exact `WEB_ORIGIN` values. Google OAuth credentials are API-only: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the ignored local environment file or API secret manager to enable Google sign-in. The callback URL is `${WEB_ORIGIN}/api/auth/callback/google`; register that exact browser-visible URL with Google. The web app uses the same-origin `/api` path by default. Never expose API secrets through `VITE_` variables.

## FMP provider boundary

The API-only adapter lives in `apps/api/src/providers/fmp/` and uses FMP's [stable API](https://site.financialmodelingprep.com/developer/docs/quickstart). `FMP_BASE_URL` defaults to `https://financialmodelingprep.com/stable/`; overrides must use HTTPS, with loopback HTTP allowed for local fake providers outside production. Do not include credentials, query parameters, or fragments in the base URL. `FMP_API_KEY` may remain empty while provider features are unused; an attempt without a key returns `NOT_CONFIGURED` without reserving quota or making an HTTP call. Live credentials belong only in ignored `.env.local` or the API's hosted secret manager, never a `VITE_` variable or browser-importable package.

Each adapter `request` performs one GET attempt and requires an injected `reserveRequest` function. That function must atomically reserve one shared budget unit immediately before dispatch, returning false on exhaustion. Reservation errors fail closed. Dispatched HTTP errors, transport failures, timeouts, invalid JSON, invalid response shapes, and provider error envelopes retain their charge. The timeout defaults to 10 seconds and includes response-body consumption. Results contain safe failure codes and HTTP status only; raw provider bodies, URLs, keys, and transport exceptions are not returned or logged.

The transport makes no automatic retries, redirects, profile follow-ups, or pagination calls. A caller explicitly retries or requests a follow-up through the same adapter, reserving another unit each time. Cached results bypass the adapter entirely. The adapter validates responses against internal Zod schemas. Historical responses use a dedicated JSON parser that preserves the original numeric closing-price token before decimal validation.

Durable PostgreSQL quota reservations, quota-day configuration, quote-cache persistence, and refresh concurrency guarantees belong to 7A. The API's normal startup currently returns `503 PROVIDER_UNAVAILABLE` for uncached instrument searches, even if an FMP key is present, because the shared reservation store is not connected yet. There is no production in-memory quota fallback. Controlled callers can pass `buildServer({ fmp: { reserveRequest, fetch?, timeoutMs? } })` to exercise search with an explicit test budget; deployed dispatch must use the durable store when it is implemented. Automated tests use a loopback fake provider and assert quota deltas without live calls. No additional developer configuration is required for this slice.

## Instrument search

`GET /api/instruments/search?q=AAPL` searches by symbol; `GET /api/instruments/search?q=Apple&mode=name` searches by company name. Authentication and the existing per-IP/per-user limits apply, and responses use `Cache-Control: no-store`. The query must contain 1–100 characters with at least one non-whitespace character. Unknown parameters, repeated query values, and unsupported modes are rejected before provider dispatch. Search text is trimmed before sending it as an encoded query value to FMP's [symbol](https://site.financialmodelingprep.com/developer/docs/stable/search-symbol) or [name](https://site.financialmodelingprep.com/developer/docs/stable/search-name) endpoint.

The API requests at most ten candidates and processes no more than ten returned rows. It deduplicates symbols and requests a company profile sequentially only when a candidate lacks a name or currency; missing exchange alone is represented as `null`. Every dispatched search/profile costs one reserved unit, including failures. A fully populated search costs one unit; a search requiring one profile costs two. Ten missing profiles can cost eleven total requests, with each reserved only when needed. There are no automatic retries or symbol-to-name fallback calls; an explicit retry after failure starts a new search and charges each dispatched attempt.

The response contains `results` with explicit USD `quoteCurrency`, and `excluded` entries with `NON_USD`, `CURRENCY_MISMATCH`, `UNSUPPORTED_INSTRUMENT`, or `DETAILS_UNAVAILABLE` reasons. Missing currency is never assumed to be USD. Known fund/ETF flags and crypto/forex/commodity/index exchanges are excluded. Complete search candidates are discovery metadata, not proof of stock eligibility when FMP omits classification flags; BUY validation must verify instrument eligibility in 5D. Instrument/currency persistence also belongs to 5D. Raw provider fields and provider error bodies are not exposed.

Successful responses, including empty results and explicit exclusions, are cached for 60 seconds in the API process with at most 100 query/mode entries. Exact trimmed text and mode form the key. Cache hits consume zero provider units and remain usable while the request budget is exhausted; failures are not cached. This bounded discovery cache is disposable and separate from the durable per-symbol quote cache planned for 7A. Concurrent cache misses each reserve their own dispatched requests; this slice does not establish cross-process deduplication.

Provider failures use the common error DTO: `502 PROVIDER_ERROR` for failed/invalid provider responses, `503 PROVIDER_UNAVAILABLE` for missing configuration/reservation storage, `503 PROVIDER_QUOTA_EXHAUSTED` for a rejected budget reservation, and `504 PROVIDER_TIMEOUT` for a timed-out request. Provider-side HTTP 429 is treated as a provider failure rather than claiming that a measured daily budget is exhausted. Only application request throttles use HTTP 429 with `Retry-After`.

## Historical quotes

`GET /api/instruments/AAPL/price?date=2026-10-18` returns the latest available closing price on or before the selected trade date. The response preserves `requestedDate` and includes `effectiveDate`, exact-decimal `unitPrice`, explicit USD `currency`, `source: "FMP"`, UTC `retrievedAt`, and `usedPreviousTradingDay`. Selection uses actual provider records, rather than a weekday calendar, so weekends, holidays, long suspensions, unordered records, and unpublished closes can fall back to the most recent earlier quote. Future records are never selected. Future requested dates are rejected before dispatch using the initial `America/New_York` market day, independently of the server timezone; environment-configurable market settings remain in 7A.

The service first requests the company profile to verify the requested symbol and source quote currency. Non-USD profiles return `422 UNSUPPORTED_CURRENCY`; missing currency returns `422 CURRENCY_UNAVAILABLE`. The FMP [full historical EOD endpoint](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full) normally omits currency, so its price uses the verified profile's quote currency. An explicit conflicting currency in a historical row returns `422 CURRENCY_MISMATCH`. Invalid symbols, invalid dates, conflicting closes for the same day, malformed provider data, and prices outside the supported decimal range are rejected. This is quote lookup; stock eligibility and persisted instrument/transaction currency checks remain required in 5D.

History is requested in consecutive, non-overlapping windows of at most five years, following FMP's [documented history-range limit](https://site.financialmodelingprep.com/faqs?code=platform). Each window ends at or before the requested date. An empty window advances the lookup backward, stopping at the profile's IPO date when provided. A lookup sends at most five historical requests plus one profile request. Reaching the request cap before earlier history is covered returns `503 PRICE_LOOKUP_INCOMPLETE`, not a claim that no earlier price exists. `404 PRICE_NOT_AVAILABLE` means the selected date precedes the known IPO date or the available history boundary was reached without finding a quote; an absent profile returns the normal `404 NOT_FOUND`. Provider plan access can still prevent historical coverage; failures use the sanitized provider error responses.

Provider numeric `close` fields are decoded using JSON source text access supported by the repository's Node.js 22.22+/24+ runtimes. Prices are validated and normalized through the existing Prisma Decimal runtime without binary-number conversion, intermediate rounding, or a new dependency. Scientific notation is expanded exactly. Returned values must fit the same positive decimal range as trade inputs: up to 22 integer and 8 fractional digits. Excess nonzero fractional precision is rejected, and insignificant trailing zeros are removed without changing the value. Historical closes reflect FMP's full-EOD data; no split, dividend, FX, or other corporate-action calculations are added.

Profile requests, historical requests, empty-window follow-ups, dispatched failures/timeouts, and explicit retries each consume their own reservation. A normal cache miss costs two requests; a missing-history lookup can cost up to six. Successful quotes are cached for 60 seconds in a bounded 100-entry process-local cache keyed by symbol and requested date. Cache hits consume zero units even if the budget is exhausted; failures are not cached. This cache is disposable. Durable quote persistence, quota configuration, concurrent dispatch coordination, and shared cache guarantees remain assigned to 7A. Normal API startup keeps both search and quote dispatch disabled until the shared quota reservation store is connected, returning `503 PROVIDER_UNAVAILABLE` without a live call.

Before live verification, obtain an FMP API key from the account dashboard, enter it into ignored `.env.local` or the API secret manager, and confirm the plan's permitted request budget and endpoint access. Report only that configuration is ready; never paste the key into chat. Automated tests use controlled providers with dummy keys and consume no live quota.

## API security policies

The API applies an IP-based ceiling of 100 requests per 60 seconds by default, exempts health probes, and lowers the Better Auth catch-all ceiling to 60. Better Auth enables its own PostgreSQL-backed limiter in production, with a default of 100 requests per 60 seconds and a stricter 5-per-60-second rule for credential, password-reset, and email-verification endpoints. Limits are configurable through the validated `API_*` and `BETTER_AUTH_*RATE_LIMIT*` settings. Authenticated private route scopes add a separate 300-per-60-second user limit after session resolution. Fastify and Better Auth both use the IP Fastify resolves after applying `API_TRUSTED_PROXY_CIDRS`, and both group IPv6 addresses by `/64`.

Configure the ingress to overwrite forwarded client-IP headers, prevent direct public access to the API origin, and list only verified proxy IPs/CIDRs in `API_TRUSTED_PROXY_CIDRS`. Better Auth receives Fastify's resolved IP through an internal `x-real-ip` header; incoming client values for that header are replaced. Private API mutations require an exact `Origin`, or an exact trusted origin parsed from `Referer` only when `Origin` is absent. Safe `GET`, `HEAD`, and `OPTIONS` methods do not require origin evidence. Better Auth auth endpoints keep their built-in CSRF/origin protections.

The initial deployment supports one API process. Better Auth rate-limit counters use PostgreSQL. Before running multiple API replicas, configure shared Redis storage for Fastify's counters as well; do not rely on its process-local store across replicas. Verify at the ingress that spoofed forwarded headers cannot change a client's rate-limit bucket.

Better Auth exposes its public authentication handler under `/api/auth/*`, stores users and sessions in PostgreSQL, and supports email/password registration and login plus Google sign-in when its API credentials are configured. New passwords must be 8 to 128 characters. Session cookies are HttpOnly and SameSite=Lax, use Secure in production or when `API_HTTPS_ENABLED=true`, and remain host-only. The browser provides account registration, login, Google sign-in, session-aware redirects, and logout.

## API documentation

Private API responses use `Cache-Control: no-store`, including successful requests and errors. Wallet writes return sanitized errors for invalid JSON or content length (`400`), bodies exceeding the size limit (`413`), and unsupported content types (`415`). Unexpected failures return a sanitized `500` response.

Wallet metadata updates return the values written by that request atomically. Wallet lists use independent queries for page rows and total counts; concurrent writes may briefly make those results disagree. Snapshot-consistent pagination is not required for the initial dashboard.

`DELETE /api/wallets/:walletId` permanently removes the authenticated user's selected wallet and returns `204` with no response body. Missing, previously deleted, and foreign-owned wallets all return `404`. Ownership is part of the delete query, so concurrent deletion requests produce one success and subsequent `404` responses. Authentication, mutation-origin checks, private rate limits, and `Cache-Control: no-store` apply to deletion as well.

The wallet detail page offers a permanent-delete flow with an irreversible warning followed by a final warning and exact-name confirmation. Matching is case-sensitive and preserves spaces. The final delete button must be explicitly activated; Enter in the name input does not delete. Cancel or Escape before submission keeps the wallet and resets the confirmation. While submitting, the controls are disabled and the dialog stays open. Successful deletion returns to a refreshed wallet list. Failures display safe feedback without claiming success; an uncertain network result asks the user to check the wallet list before retrying. The browser route action checks the latest wallet name before sending DELETE; API ownership checks remain authoritative.

The current database contains wallet metadata only. When ledger and pricing persistence are introduced, wallet-owned transactions, metadata, materialized summaries, and refresh subscriptions must reference the wallet with cascading cleanup. Global instruments, price snapshots, quota accounting, and symbol-level refresh work must remain independent of wallet ownership. Deleting a refresh subscription must preserve work needed by another wallet. Add real PostgreSQL deletion regression tests with those models in the slices that introduce them; the current suite cannot verify cleanup or preservation of tables that do not yet exist.

With the API running locally, open Swagger UI at `http://127.0.0.1:3000/documentation/`. The page loads the registered API contract and can send requests to its `/api` endpoints. Swagger UI serves its scripts and styles from the API origin under a static Content Security Policy; keep inline scripts and styles disabled rather than weakening Helmet's policy.

The Compose service binds PostgreSQL to loopback and creates `wallet_dev` plus `wallet_test` on first initialization of its named volume. Initialization scripts run only when that volume is empty. `pnpm db:stop` stops PostgreSQL without removing data. `pnpm db:down` removes the container and network but preserves the named volume. `pnpm db:destroy-local-data` removes the volume and permanently deletes both local databases; use it only when you intend to discard all local database data. To clear only test objects, use `pnpm db:reset:test:local`; it refuses to run unless `.env.ci.local` explicitly sets `NODE_ENV=test` and points to the loopback `wallet_test` database. Never use production data for local development or tests.

Browser journey tests run in Chromium with mocked auth responses. Install the browser once with `pnpm --filter @my-wallets/e2e exec playwright install chromium`, then run them with `pnpm test:e2e`.

Contract tests run from `src`, and the contracts build excludes test files so compiled copies are not counted as additional tests. The API Vitest runner uses at most four workers to bound database and Fastify/Swagger initialization work when the workspace suites run together. Run checks that generate Prisma (typecheck, API tests, builds, and contract generation) sequentially to avoid concurrent writes to the generated client.

## Route configuration

The web app uses React Router Data Mode. `src/app/router.tsx` owns the typed `RouteObject` tree, and `src/main.tsx` mounts its `RouterProvider`. Route components are ordinary modules imported directly by route objects; folders are not file-system routes. Use nested routes with layout components and `<Outlet />` when routes share a shell. Keep each route's component and any future loader, action, or error boundary with the route behavior it owns. Keep the router focused on route composition, use direct imports instead of convenience re-export files, and load or mutate server state through route data APIs that call the typed API client.
