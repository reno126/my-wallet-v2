# Architecture

[Project overview](../README.md)

This document describes the implemented application. Requirements, delivery order, and planned extensions remain authoritative in [the implementation plan](../IMPLEMENTATION_PLAN.md).

## Workspace boundaries

- `apps/web`: React SPA using React Router Data Mode. It renders validated API data and owns forms, navigation, and page feedback.
- `apps/api`: Fastify application owning authentication, authorization, financial validation, persistence, and all FMP communication.
- `packages/contracts`: browser-safe Zod schemas, the generated OpenAPI document, and types shared across the API/browser boundary.
- PostgreSQL and Prisma store users, sessions, wallets, shared instruments, and immutable BUY/SELL transactions. Future read models and pricing persistence follow their mapped delivery slices.

The browser calls the application API, and the API calls FMP. Financial amounts cross the boundary as exact decimal strings with explicit currency. The current application supports USD only.

## FMP provider boundary

The API-only adapter lives in `apps/api/src/providers/fmp/` and uses FMP's [stable API](https://site.financialmodelingprep.com/developer/docs/quickstart). `FMP_BASE_URL` defaults to `https://financialmodelingprep.com/stable/`; overrides must use HTTPS, with loopback HTTP allowed for local fake providers outside production. Do not include credentials, query parameters, or fragments in the base URL. `FMP_API_KEY` may remain empty while provider features are unused; an attempt without a key returns `NOT_CONFIGURED` without reserving quota or making an HTTP call. Live credentials belong only in ignored `.env.local` or the API's hosted secret manager, never a `VITE_` variable or browser-importable package.

Each adapter `request` performs one GET attempt and requires an injected `reserveRequest` function. That function must atomically reserve one shared budget unit immediately before dispatch, returning false on exhaustion. Reservation errors fail closed. Dispatched HTTP errors, transport failures, timeouts, invalid JSON, invalid response shapes, and provider error envelopes retain their charge. The timeout defaults to 10 seconds and includes response-body consumption. Results contain safe failure codes and HTTP status only; raw provider bodies, URLs, keys, and transport exceptions are not returned or logged.

The transport makes no automatic retries, redirects, profile follow-ups, or pagination calls. A caller explicitly retries or requests a follow-up through the same adapter, reserving another unit each time. Cached results bypass the adapter entirely. The adapter validates responses against internal Zod schemas. Historical responses use a dedicated JSON parser that preserves the original numeric closing-price token before decimal validation.

Durable PostgreSQL quota reservations, quota-day configuration, quote-cache persistence, and refresh concurrency guarantees belong to 7A. The API's normal startup currently returns `503 PROVIDER_UNAVAILABLE` for uncached instrument searches, even if an FMP key is present, because the shared reservation store is not connected yet. There is no production in-memory quota fallback. Controlled callers can pass `buildServer({ fmp: { reserveRequest, fetch?, timeoutMs? } })` to exercise search with an explicit test budget; deployed dispatch must use the durable store when it is implemented. Automated tests use a loopback fake provider and assert quota deltas without live calls. For the current user-facing limitation, see [provider availability](api.md#provider-availability).

## Ledger persistence and wallet ownership

The transaction service prepares an internal command: BUY requires verified instrument metadata, while SELL excludes that metadata. Shared instrument and command types live in the domain layer. The repository prepares the instrument under the wallet lock, checking symbol/currency consistency before any BUY upsert.

The server checks wallet ownership before contacting FMP and verifies it again under a database lock before inserting. Missing and foreign wallets both return `404` without provider dispatch. Concurrent BUYs and SELLs share a wallet row lock, which also coordinates with wallet deletion. BUY provider calls happen before the database transaction, so a wallet deleted during verification returns `404` without ledger or instrument writes; an already dispatched profile request still consumes its reserved quota unit. SELL uses persisted instrument metadata without contacting FMP.

The write transaction explicitly uses `ReadCommitted` isolation. It acquires the owned wallet with `SELECT ... FOR UPDATE`, inserts the candidate, reads the affected symbol's complete ledger, and runs FIFO replay using persisted IDs and timestamps. Ledger reads after the lock see the preceding writer's commit. If any historical sale oversells, a private rollback exception rejects the Prisma transaction; the repository catches it after rollback and returns `INSUFFICIENT_HOLDING` as a normal `Result` failure. Returning a failure object from inside Prisma's transaction callback would commit the inserted row, so that rollback exception stays confined to this boundary. This follows PostgreSQL's [locking and consistency guidance](https://www.postgresql.org/docs/17/applevel-consistency.html). Locks serialize all symbols within a wallet; separate wallets can write independently.

The database stores shared instrument records and wallet-owned transactions. Deleting a wallet cascades only its transactions; shared instruments survive even when their last wallet is deleted, and other wallets retain their transactions. Referenced instruments cannot be deleted. PostgreSQL integration tests cover these guarantees, numeric boundaries, exact concurrent totals, ownership, immutable rows, rollback, and deletion during profile verification. Shared prices, quota persistence, and refresh subscriptions still require their follow-through checks in 7A–7C.

When pricing persistence is introduced, wallet-specific materialized summaries and refresh subscriptions must also reference the wallet with cascading cleanup. Global price snapshots, quota accounting, and symbol-level refresh work must remain independent of wallet ownership. Deleting a refresh subscription must preserve work needed by another wallet. Real PostgreSQL deletion regression tests remain required with those models in 7A–7C; the current suite cannot verify cleanup or preservation of tables that do not yet exist.

The pure [accounting core](accounting.md) replays one wallet/instrument ledger in deterministic order, consumes original acquisition lots using FIFO, and calculates remaining cost basis, weighted-average unit cost, and realized P/L with exact decimal arithmetic. It is independent of persistence and HTTP. Accounting read endpoints remain in 6D.

Transaction creation and latest-only deletion use the repository's shared `withLockedWallet` transaction boundary, including the ownership check, `ReadCommitted` isolation, wallet row lock, and rollback mapping. Deletion scopes the target to that wallet, checks it against all entries for its instrument with the same comparator as FIFO, and hard-deletes only when it is latest. The remaining immutable entries are replayed from the locked snapshot before commit. Conflicts preserve all rows; no deleted-row audit copy is kept. See [the deletion API](api.md#latest-transaction-deletion).

Endpoint behavior and provider request costs are documented in [API behavior](api.md). Price persistence and refresh coordination remain in the [delivery slice map](../IMPLEMENTATION_PLAN.md#delivery-slice-map).

## Route configuration

The web app uses React Router Data Mode. [`router.tsx`](../apps/web/src/app/router.tsx) owns the typed `RouteObject` tree, and [`main.tsx`](../apps/web/src/main.tsx) mounts its `RouterProvider`. Route components are ordinary modules imported directly by route objects; folders are not file-system routes. Use nested routes with layout components and `<Outlet />` when routes share a shell. Keep each route's component and any future loader, action, or error boundary with the route behavior it owns. Keep the router focused on route composition, use direct imports instead of convenience re-export files, and load or mutate server state through route data APIs that call the typed API client.

Page-essential reads use `requirePageData` to return validated data or throw a safe route failure. A shared boundary below the authenticated layout keeps navigation available. Expired sessions redirect to login; wallet detail and purchase loaders treat invalid IDs, missing wallets, and inaccessible wallets as the same unavailable page. Other forbidden reads show access denied. Transient failures offer a GET revalidation retry, delayed by `Retry-After` when supplied; retry never replays a mutation. Unexpected exceptions show generic feedback with a page reload. Form submissions and inline stock/quote lookups retain their local error handling so recoverable failures preserve entered values.

Wallet and purchase loaders/actions bind cancellation once with `createRequestClient(request.signal)`, then compose the domain APIs they need, such as `createWalletApi(client)` or `createPurchasesApi(client)`. Each invocation gets its own typed HTTP client and result handler; multiple domain APIs can share that client, and endpoint methods receive only their business inputs. New domain APIs use the shared client without registration in a central catalogue. The shared client propagates cancellation to HTTP and throws cancellation reasons before dispatch or after a late response, keeping cancelled work out of normal error and success feedback. Action-body parsing retains its own cancellation checks. Cancelling a dispatched mutation does not guarantee server rollback, so uncertain purchase outcomes still require their existing handling. Better Auth uses a separate client and is outside this cancellation binding.

## Wallet deletion journey

The wallet detail page offers a permanent-delete flow with an irreversible warning followed by a final warning and exact-name confirmation. Matching is case-sensitive and preserves spaces. The final delete button must be explicitly activated; Enter in the name input does not delete. Cancel or Escape before submission keeps the wallet and resets the confirmation. While submitting, the controls are disabled and the dialog stays open. Successful deletion returns to a refreshed wallet list. Failures display safe feedback without claiming success; an uncertain network result asks the user to check the wallet list before retrying. The browser route action checks the latest wallet name before sending DELETE; API ownership checks remain authoritative.

## Purchase journey

The wallet detail page links to `/wallets/:walletId/buy`. Search by symbol or company name, select a verified USD result, choose the trade date, and enter quantity and an optional description. The page displays the closing price, its effective date, and the exact decimal price that will be saved. Changing the search, stock, or date invalidates the previous price. Weekend/holiday fallback preserves the selected trade date. The API remains authoritative for stock eligibility, ownership, currency, and validation. A successful save returns to the wallet with a toast; an uncertain save blocks resubmission on the page to reduce duplicate purchases. Transaction history arrives in Phase 6. Live provider dispatch remains disabled until the durable quota store in 7A, so normal local provider searches show an unavailable state; the automated purchase journey uses an injected fake and needs no real FMP key.

See [testing](testing.md) for browser and PostgreSQL verification, and [security and deployment](security-and-deployment.md) for the runtime boundary.
