# API behavior

[Project overview](../README.md)

The generated contract is authoritative for request/response schemas, required fields, and documented statuses. This guide explains behavior and operational constraints; update schemas and regenerate OpenAPI when endpoint contracts change.

## Contracts and Swagger

- [OpenAPI document](../packages/contracts/openapi.json)
- [Shared contract schemas](../packages/contracts/src/schemas)
- [Generated browser types](../apps/web/src/api/generated/openapi.d.ts)

With the API running locally, open Swagger UI at `http://127.0.0.1:3000/documentation/`. The page loads the registered API contract and can send requests to its `/api` endpoints. Swagger UI serves its scripts and styles from the API origin under a static Content Security Policy; keep inline scripts and styles disabled rather than weakening Helmet's policy.

## Common response behavior

Private API responses use `Cache-Control: no-store`, including successful requests and errors. Wallet writes return sanitized errors for invalid JSON or content length (`400`), bodies exceeding the size limit (`413`), and unsupported content types (`415`). Unexpected failures return a sanitized `500` response.

Authentication, request limits, mutation-origin checks, and cookies are described in [security and deployment](security-and-deployment.md). Browser handling of page failures and cancellation is described in [architecture](architecture.md#route-configuration).

## Wallet lifecycle

Wallet metadata updates return the values written by that request atomically. Wallet lists use independent queries for page rows and total counts; concurrent writes may briefly make those results disagree. Snapshot-consistent pagination is not required for the initial dashboard.

`DELETE /api/wallets/:walletId` permanently removes the authenticated user's selected wallet and returns `204` with no response body. Missing, previously deleted, and foreign-owned wallets all return `404`. Ownership is part of the delete query, so concurrent deletion requests produce one success and subsequent `404` responses. Authentication, mutation-origin checks, private rate limits, and `Cache-Control: no-store` apply to deletion as well.

## Provider availability

Normal startup connects FMP requests to the PostgreSQL daily budget. After applying the cache/quota migration, search, historical quotes and BUY verification can dispatch when an API-only FMP key is configured. Production additionally requires an explicit daily limit and IANA reset timezone. Missing keys, unavailable storage or a policy mismatch fail closed with `503 PROVIDER_UNAVAILABLE`; exhausted tracked allowance returns `503 PROVIDER_QUOTA_EXHAUSTED`. See [market-data persistence](market-data.md) for configuration and reset behavior. There is no production in-memory quota fallback. See [the provider boundary](architecture.md#fmp-provider-boundary) for controlled injection and request accounting, and [testing](testing.md#browser-journeys) for fake-provider coverage.

## Instrument search

`GET /api/instruments/search?q=AAPL` searches by symbol; `GET /api/instruments/search?q=Apple&mode=name` searches by company name. Authentication and the existing per-IP/per-user limits apply, and responses use `Cache-Control: no-store`. The query must contain 1–100 characters with at least one non-whitespace character. Unknown parameters, repeated query values, and unsupported modes are rejected before provider dispatch. Search text is trimmed before sending it as an encoded query value to FMP's [symbol](https://site.financialmodelingprep.com/developer/docs/stable/search-symbol) or [name](https://site.financialmodelingprep.com/developer/docs/stable/search-name) endpoint.

The API requests at most ten candidates and processes no more than ten returned rows. It deduplicates symbols and requests a company profile sequentially only when a candidate lacks a name or currency; missing exchange alone is represented as `null`. Every dispatched search/profile costs one reserved unit, including failures. A fully populated search costs one unit; a search requiring one profile costs two. Ten missing profiles can cost eleven total requests, with each reserved only when needed. There are no automatic retries or symbol-to-name fallback calls; an explicit retry after failure starts a new search and charges each dispatched attempt.

The response contains `results` with explicit USD `quoteCurrency`, and `excluded` entries with `NON_USD`, `CURRENCY_MISMATCH`, `UNSUPPORTED_INSTRUMENT`, or `DETAILS_UNAVAILABLE` reasons. Missing currency is never assumed to be USD. Known fund/ETF flags and crypto/forex/commodity/index exchanges are excluded. Complete search candidates are discovery metadata and do not prove stock eligibility when FMP omits classification flags. [BUY validation](#buy-transactions) verifies eligibility before instrument and transaction persistence. Raw provider fields and provider error bodies are not exposed.

Successful responses, including empty results and explicit exclusions, are cached for 60 seconds in the API process with at most 100 query/mode entries. Exact trimmed text and mode form the key. Cache hits consume zero provider units and remain usable while the request budget is exhausted; failures are not cached. This bounded discovery cache is disposable and separate from the durable per-symbol current-quote cache supplied by 7A. Concurrent cache misses each reserve their own dispatched requests; the process-local cache provides no cross-process deduplication.

Provider failures use the common error DTO: `502 PROVIDER_ERROR` for failed/invalid provider responses, `503 PROVIDER_UNAVAILABLE` for missing configuration/reservation storage, `503 PROVIDER_QUOTA_EXHAUSTED` for a rejected budget reservation, and `504 PROVIDER_TIMEOUT` for a timed-out request. Provider-side HTTP 429 is treated as a provider failure rather than claiming that a measured daily budget is exhausted. Only application request throttles use HTTP 429 with `Retry-After`.

## Historical quotes

`GET /api/instruments/AAPL/price?date=2026-10-18` returns the latest available closing price on or before the selected trade date. The response preserves `requestedDate` and includes `effectiveDate`, exact-decimal `unitPrice`, explicit USD `currency`, `source: "FMP"`, UTC `retrievedAt`, and `usedPreviousTradingDay`. Selection uses actual provider records, rather than a weekday calendar, so weekends, holidays, long suspensions, unordered records, and unpublished closes can fall back to the most recent earlier quote. Future records are never selected. Future requested dates are rejected before dispatch using the initial `America/New_York` market day, independently of the server timezone. The separately configurable quota/freshness timezone is documented in [market-data persistence](market-data.md#quota-configuration).

The service first requests the company profile to verify the requested symbol and source quote currency. Non-USD profiles return `422 UNSUPPORTED_CURRENCY`; missing currency returns `422 CURRENCY_UNAVAILABLE`. The FMP [full historical EOD endpoint](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-full) normally omits currency, so its price uses the verified profile's quote currency. An explicit conflicting currency in a historical row returns `422 CURRENCY_MISMATCH`. Invalid symbols, invalid dates, conflicting closes for the same day, malformed provider data, and prices outside the supported decimal range are rejected. This is quote lookup; BUY validation separately checks stock eligibility and persisted instrument/transaction currency.

History is requested in consecutive, non-overlapping windows of at most five years, following FMP's [documented history-range limit](https://site.financialmodelingprep.com/faqs?code=platform). Each window ends at or before the requested date. An empty window advances the lookup backward, stopping at the profile's IPO date when provided. A lookup sends at most five historical requests plus one profile request. Reaching the request cap before earlier history is covered returns `503 PRICE_LOOKUP_INCOMPLETE`, not a claim that no earlier price exists. `404 PRICE_NOT_AVAILABLE` means the selected date precedes the known IPO date or the available history boundary was reached without finding a quote; an absent profile returns the normal `404 NOT_FOUND`. Provider plan access can still prevent historical coverage; failures use the sanitized provider error responses.

Provider numeric `close` fields are decoded using JSON source text access supported by the repository's Node.js 22.22+/24+ runtimes. Prices are validated and normalized through the existing Prisma Decimal runtime without binary-number conversion, intermediate rounding, or a new dependency. Scientific notation is expanded exactly. Returned values must fit the same positive decimal range as trade inputs: up to 22 integer and 8 fractional digits. Excess nonzero fractional precision is rejected, and insignificant trailing zeros are removed without changing the value. Historical closes reflect FMP's full-EOD data; no split, dividend, FX, or other corporate-action calculations are added.

Profile requests, historical requests, empty-window follow-ups, dispatched failures/timeouts, and explicit retries each consume their own reservation. A normal cache miss costs two requests; a missing-history lookup can cost up to six. Successful quotes are cached for 60 seconds in a bounded 100-entry process-local cache keyed by symbol and requested date. Cache hits consume zero units even if the budget is exhausted; failures are not cached. This cache is disposable. Normal startup uses durable quota reservations. The new per-symbol snapshot/lease store supports the upcoming current-quote scheduler and does not replace this requested-date historical cache. Queue orchestration and retry scheduling remain in 7B.

Before live verification, obtain an FMP API key from the account dashboard, enter it into ignored `.env.local` or the API secret manager, and confirm the plan's permitted request budget and endpoint access. Report only that configuration is ready; never paste the key into chat. Automated tests use controlled providers with dummy keys and consume no live quota.

## BUY transactions

`POST /api/wallets/:walletId/transactions` records an immutable purchase or sale. Send `symbol`, `side: "BUY"` or `"SELL"`, `transactionDate` (`YYYY-MM-DD`), positive decimal-string `quantity` and `unitPrice`, `currency: "USD"`, and an optional description of at most 500 characters. Unknown fields, unsupported sides, zero/negative values, numeric JSON amounts, exponent notation, more than 22 integer digits, and more than eight fractional digits are rejected. Future transaction dates use the same New York market-day boundary as historical lookup. The entered date and exact accepted values are preserved; a weekend quote's effective date does not replace the entered trade date. Unit price is the entered execution price and is not overwritten by a new quote lookup.

The `201` response contains `transaction` with a server-generated ID and UTC creation timestamp, plus `holding` with the resulting exact share quantity for that wallet/symbol and explicit quote currency. Holdings are recalculated by the [FIFO accounting core](accounting.md) from the complete BUY/SELL ledger inside the write transaction; totals can exceed a single input's maximum. A full sale returns holding quantity `"0"`. Ledger-only cost-basis/history endpoints are available; live-price valuation follows in Phase 7. Transaction editing is unsupported, and a database trigger also rejects updates to ledger rows. Corrections use latest-only deletion and normal creation.

Each BUY requests the [FMP company profile](https://site.financialmodelingprep.com/developer/docs/stable/profile-symbol) once to verify the symbol, company name, exchange, explicit USD currency, and explicit `isEtf: false` / `isFund: false` classification. Missing classification/exchange and known unsupported exchanges fail closed with `422 UNSUPPORTED_INSTRUMENT`; non-USD and missing currency use the existing currency failures. Client-supplied discovery metadata cannot establish eligibility. Verification is not cached, makes no automatic retries, and does not repeat historical lookup. Every dispatched attempt costs one reserved request, including failed attempts. Normal startup uses the durable shared request budget and fails closed when the key or budget is unavailable; controlled-provider tests exercise successful BUYs without live credentials.

For locking, ownership rechecks, deletion races, and shared-instrument preservation, see [ledger persistence](architecture.md#ledger-persistence-and-wallet-ownership). For applying the required migrations, see [local development](local-development.md#apply-migrations-and-generate-the-client).

## SELL transactions

SELL uses the same endpoint, input precision, ownership, session, mutation-origin, and request-limit checks as BUY. It uses the stored instrument quote currency and makes no FMP requests, including when provider configuration is absent or quota is exhausted. An unheld symbol, an empty position, or a sale exceeding inventory returns `409 INSUFFICIENT_HOLDING` without retaining the candidate row. Missing and foreign wallets return `404`.

The server locks the owned wallet and replays the complete affected-symbol ledger, including the candidate sale, in ascending transaction-date/creation-time/id order before committing. A sale must be covered at its historical position, and every later sale must remain covered. Backdated sales can therefore fail even when today's holding is sufficient. Concurrent SELLs and BUYs share this lock; rejected writes are rolled back atomically. Returned holding quantities reflect the ledger at that request's commit and may change with later writes. The SELL modal accepts an entered execution price and previews proceeds without a provider lookup; see the browser ledger workflow in the architecture guide.

## Ledger history and holdings

These authenticated GET endpoints read persisted USD transactions without provider calls or price configuration:

| Endpoint                                  | Response                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/wallets/:walletId/transactions`     | Paginated history, newest first by trade date, creation timestamp, then ID.                                                          |
| `/api/wallets/:walletId/holdings`         | Wallet cost-basis and realized-P/L totals, last trade date, and instrument summaries ordered by symbol.                              |
| `/api/wallets/:walletId/holdings/:symbol` | One instrument's quantity, remaining FIFO acquisition cost, weighted-average remaining unit cost, realized P/L, and last trade date. |

History accepts `page` (default 1, maximum 10,000), `pageSize` (default 25, maximum 100), and an optional case-insensitive `symbol`. Each row preserves the entered trade fields and adds `totalAmount` (exact quantity × unit price), `realizedProfitLoss` (the sale's FIFO result, or `null` for BUY), and `canDelete`. Eligibility uses the complete instrument ledger before pagination; an older page does not acquire a new deletable row. The response includes page, page size, total count and total pages. Pages beyond the result set and unknown symbol filters return empty history.

Holdings include fully closed positions: quantity and remaining cost are `"0"`, average cost is `null`, and accumulated realized P/L remains visible. Reopening a position preserves those realized results. A symbol with no remaining ledger rows is absent from holdings and returns `404` from its detail endpoint, even if shared instrument metadata exists. Empty wallets return zero totals, an empty holdings array and a `null` last transaction date. Monetary fields use the explicit quote/reporting currency; history amounts use each row's currency. All calculated values are unrounded decimal strings, and repeating averages use the accounting core's 100-significant-digit context.

Each response reads ownership, transactions and instrument metadata in a short PostgreSQL `RepeatableRead` transaction. FIFO calculation and DTO mapping run after that snapshot is loaded. Reads do not take the wallet write lock, expose uncommitted trades, or call the provider. Separate requests can observe different committed snapshots. A history row's `canDelete` can become stale; DELETE still checks under its write lock. History pagination bounds the response, while accounting currently replays the complete matching ledger in memory. There is no materialized summary or ledger-size cap in this release.

Missing or inaccessible wallets return `404`, malformed identifiers/queries return `400`, missing sessions return `401`, private request limits return `429`, and unexpected database or invalid-ledger failures return sanitized `500` responses. All responses use `Cache-Control: no-store`. Current market value, live price, unrealized P/L, percentage share and freshness remain deferred to Phase 7. Wallet and instrument screens consume these summaries and paginated history directly.

## Latest transaction deletion

`DELETE /api/wallets/:walletId/transactions/:transactionId` permanently removes the selected transaction only when it is the latest entry for its wallet/instrument. Latest means descending transaction date, creation timestamp, then ID; there is no BUY/SELL priority. A newer trade for another instrument does not affect eligibility. The server derives the instrument from the stored transaction, and checks ownership and eligibility under the same wallet lock as BUY/SELL creation.

Success returns `204` with no body after the remaining ledger has been replayed atomically. Older entries return `409 CONFLICT` without mutation; remove newer trades in reverse order first. A missing wallet, a foreign wallet, a missing transaction, or a transaction outside the selected wallet returns `404 NOT_FOUND`. A repeated request after successful deletion returns `404`. A replay oversell returns `409 INSUFFICIENT_HOLDING` and rolls back deletion. Unexpected failures return sanitized `500` responses. UUID path validation, session checks, trusted mutation origins, private request limits, and `Cache-Control: no-store` apply.

Deletion makes no provider requests, leaves shared instrument metadata intact, and retains no audit copy. Re-enter a corrected trade through the existing POST endpoint, which generates a new identity and creation timestamp and validates all historical sales again. The browser requires a destructive confirmation and revalidates the active summaries after success. Read the ledger endpoints again for updated summaries; the delete response has no body.
