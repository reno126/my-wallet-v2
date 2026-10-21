# Shared market data and refresh scheduling

[Project overview](../README.md) · [API behavior](api.md#provider-availability)

Slices 7A–7C supply PostgreSQL quota accounting, shared quote snapshots, durable refresh intent, wallet subscriptions, fenced leases, scheduling, restart recovery and graceful shutdown. Normal search, historical lookup and BUY verification use the durable budget. Public valuation/status endpoints and wallet-open triggers arrive in 7D, and freshness UI in 7E. Existing browser routes do not yet enqueue refresh work.

## Quota configuration

| API-only variable         | Development/test default | Meaning                                                   |
| ------------------------- | ------------------------ | --------------------------------------------------------- |
| `FMP_DAILY_REQUEST_LIMIT` | `250`                    | Maximum tracked outbound reservations per quota day       |
| `FMP_QUOTA_TIMEZONE`      | `America/New_York`       | IANA timezone defining local midnight and quote freshness |
| `FMP_REFRESH_CONCURRENCY` | `3`                      | Maximum concurrent refresh tasks; integer from 1 to 5     |

Production with an FMP key requires both variables explicitly. `US` is ambiguous and is rejected; the deployed reset timezone must be confirmed for the target environment. The approved operational limit is 250. No provider key is needed for automated tests.

The first reservation persists one `FMP` policy in `provider_budget`. Later processes must match its limit and timezone or fail closed. There is one shared application budget per database, independent of users, wallets, symbols and API restarts. Development, CI and production must use separate databases. A coordinated policy change requires stopping dispatch, updating the persisted policy and all API configurations consistently, then restarting. Do not delete counters or change timezone during an active quota day to obtain another allowance.

`provider_quota_day` retains each day's used count. A conditional PostgreSQL upsert increments it only below the policy limit. Every search, needed profile/history follow-up and explicit retry reserves separately immediately before HTTP dispatch. Failed responses and transport errors keep their charges; there are no refunds. Missing keys and denied reservations cause no dispatch. Database/policy failures return the existing sanitized provider-unavailable result.

The calendar uses UTC instants and the configured timezone, with local-midnight resets across 23- and 25-hour daylight-saving days. A reservation belongs to the day when it is reserved; an already dispatched request is not transferred or refunded at midnight. API hosts must have synchronized clocks. The repository's remaining count describes this application's tracked reservations, not authoritative provider-account remaining quota: requests made outside this application are unknown.

## Shared quote snapshots

`price_snapshot` has a unique `(symbol, marketDate)` key and stores a positive exact `NUMERIC(30,8)` price, explicit USD currency, FMP source and UTC retrieval timestamp. Writes validate symbol/date/price precision before persistence; concurrent or delayed responses cannot replace a newer retrieval with an older one. The latest read orders by market date rather than retrieval time.

A quote successfully retrieved on the configured current day can be fresh even when its market date is an earlier trading day, such as a weekend or holiday. Yesterday's retrieval and future-dated data are not fresh. Failed or exhausted refreshes preserve the previous snapshot and its retrieval timestamp. This cache belongs to the upcoming current-quote flow. The existing bounded 60-second search and historical lookup caches retain their separate keys and behavior.

## Durable refresh work

`refresh_work` stores one row per symbol: status, request/update timestamps, lease token/expiry, attempt count, next retry time and safe failure code. `refresh_subscription` connects an owned wallet to shared work. Subscription creation checks ownership under a wallet key-share lock, coordinating with deletion. Repeated requests coalesce and preserve running leases, pending retries and terminal-failure cooldowns.

An atomic claim permits one worker to acquire eligible pending work or an expired running lease and returns the incremented attempt number. Terminal failed work cannot be claimed until an explicit request reactivates it after its cooldown. Work without wallet subscriptions cannot be claimed. A random lease token fences completion/failure updates; an expired worker cannot write after reclamation. Successful completion and snapshot persistence commit together. Invalid snapshot writes roll back the status change. Failed work records only a stable application code and retry time, never provider bodies or credentials. Attempt counts count lease claims within the current request cycle, while provider quota counts every actual outbound request separately. An explicit request after success, or after a terminal-failure cooldown, starts a new cycle; coalesced requests and restart recovery preserve the existing count.

`PENDING` represents unfinished demand, including an automatic retry with a future `nextAttemptAt`. `RUNNING` carries the active lease. `FAILED` represents stopped work after a non-retryable failure, exhausted retries or quota exhaustion. It keeps its cooldown/deadline and failure code for a later explicit request. Startup recovery only selects subscribed `PENDING`/`RUNNING` rows; it never automatically restarts terminal `FAILED` rows or completed `SUCCEEDED` rows.

Wallet deletion cascades its subscriptions. It preserves shared quotes, quota accounting and symbol work, including work still needed by other wallets. An already running request can finish and retain a useful shared snapshot after its original wallet is deleted. Retained orphan work cannot acquire a new lease.

## Demand-driven scheduler

The FMP plugin creates one `priceRefresh` scheduler per API process. `requestForWallet(userId, walletId, symbol)` persists ownership-checked interest before enqueueing and returns without awaiting provider work. Internal `enqueue(symbol)` joins or starts work for an already persisted symbol and returns its completion promise. It does not create subscriptions or authorize browser requests. Slice 7D will select held symbols and call this boundary from authenticated routes.

A process-local map deduplicates normalized symbols while queued, running or waiting for retry. `p-limit` bounds active refresh tasks to the configured concurrency. Each task claims a PostgreSQL lease before accessing the cache/provider; competing schedulers cannot dispatch under the same active lease. The task checks freshness after claiming, so a quote obtained while it waited in the queue is reused at zero provider cost. Cached completions also settle the work status. Successful provider results and status updates commit together.

Queue coordination and deadline waits live in the scheduler; a separate executor owns one lease-backed attempt and its failure persistence. Current quotes, historical pricing and instrument eligibility share the same USD validation policy. Refresh failures are limited to pricing/provider outcomes, with quota and currency failures always non-retryable. If an unexpected execution error is followed by a failure-recording error, an internal `AggregateError` preserves both errors and the original cause; background logs still use only the fixed safe message.

The quote adapter first verifies the symbol's USD currency through `profile`, then requests `quote`; each HTTP dispatch reserves its own unit. A normal uncached refresh costs two units. If the profile consumes the final unit, the quote is not dispatched. Each retry repeats this validation and reserves every dispatched call. Exact price parsing is shared with historical quotes and preserves the original JSON numeric token. Market dates come from the quote timestamp in `America/New_York`; freshness and quota resets use the separately configured quota timezone. Empty, mismatched, future-dated, unsupported-currency and malformed responses do not update the cache.

Transport failures, timeouts, HTTP 429 and HTTP 5xx receive at most two automatic retries, after 1 and 2 seconds. Waiting releases the concurrency slot while keeping the symbol deduplicated. Each attempt obtains a new 180-second lease; this exceeds two maximum 60-second provider calls. Failed attempts persist a safe failure code and next eligible time. After three transient attempts, or a non-retryable failure, a five-minute cooldown prevents immediate repeat requests from dispatching again. Quota exhaustion defers eligibility until the next configured midnight, with no timer automatically scheduling a new day's work. Failure leaves the previous price and retrieval timestamp intact. Unexpected storage/execution errors are observed and logged with a fixed message, without logging provider bodies, URLs or credentials.

Refreshes are demand-driven: the scheduler does not periodically refresh every saved wallet. An already requested task or its bounded retries can finish after the browser closes. A stored wallet subscription represents interest in shared work, not a daily refresh schedule. Keep the initial deployment to one API process and introduce a shared durable queue before horizontal scaling.

## Recovery and shutdown

Fastify's `onReady` hook starts reconstruction when an FMP key is configured. The repository reads unfinished subscribed work in keyset pages of 100 symbols. Recovery prioritizes ready work during the scan, keeping at most the remaining allowance's number of waiting candidates in memory and scheduling them only with admission capacity left after ready work. Recovery schedules at most the current remaining allowance's number of symbols, rechecks quota before each enqueue, and leaves the final per-HTTP-request reservation to the shared FMP client. A normal symbol may require two requests, so this bounds queue admission without guaranteeing that every admitted symbol can finish. Exhaustion leaves outstanding intent and old snapshots intact. Recovery/store failures use a fixed safe log message and preserve the durable intent.

Pending retry deadlines and unexpired lease deadlines become cancellable, process-local waits. No unexpired lease is reclaimed. After expiry, the existing atomic claim and token fencing permit at most one competing recovery to own the symbol. The executor uses the persisted attempt number, so a restart during backoff does not grant another full retry allowance. If a process dies after dispatch, its reservation remains charged; recovery may need another charged attempt because the provider result was not committed.

`SIGINT` and `SIGTERM` close the API once. Fastify `preClose` stops admission, cancels recovery/retry timers and skips queued attempts. Already active attempts and intent writes drain; successful writes and retry intent commit before the FMP `onClose` hook finishes and Prisma disconnects. The shipped HTTP timeout is 10 seconds per call, and an active profile-plus-quote attempt can use two calls. Deployment termination grace must allow those calls and database cleanup. A forced kill leaves recoverable pending work or a lease that must expire; it does not reset quota. Timers do not keep an otherwise idle process alive.

`buildServer({ recoverRefreshWork: false })` disables startup reconstruction for controlled tooling. OpenAPI generation and the API test-server helper use it to avoid background dispatch during schema export or unrelated tests. It does not remove the internal scheduler or its shutdown hooks. There is no new environment variable, dependency or migration for 7C. Browser refresh triggers, status/quota endpoints and valuation remain in 7D; visible freshness E2E coverage remains in 7E.

## Migration and checks

Apply `20261020170000_cache_quota_persistence` before using durable provider dispatch. For local development, run the documented [migration workflow](local-development.md#apply-migrations-and-generate-the-client), then restart the API. Set the API-only FMP key in the ignored local environment or hosted secret manager; never use a `VITE_` key or send credentials in chat.

Tests use a disposable PostgreSQL database and controlled providers. They cover independent-client quota races, the final unit at the 250-request limit, quota-day boundaries, configuration disagreement, cache precision/uniqueness, lease races/fencing, rollback, retry deadlines, ownership and wallet cascade preservation. The authenticated historical API test also exercises the default durable-budget wiring without a live provider.

Scheduler unit tests use controlled promises and fake timers for queued/running/retry deduplication, default/maximum concurrency, bounded backoff, cooldowns and safe background failures. PostgreSQL scheduler tests exercise competing wallet requests, fresh-cache reuse, per-dispatch retry charges, exhaustion and stale-price preservation with a controlled FMP adapter. No live provider calls are made.

Recovery tests reconstruct separate schedulers against real PostgreSQL state, race expired claims, reject stale tokens, preserve unexpired leases, resume persisted retries and enforce remaining quota. They also verify new-cycle attempt resets, pagination, terminal/orphan exclusion, shutdown cancellation and provider persistence before Prisma disconnect. Unit tests cover cancellable deadlines, lifecycle admission, bounded reconstruction, safe storage failures and process-signal cleanup.
