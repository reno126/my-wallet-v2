# Shared market-data persistence

[Project overview](../README.md) · [API behavior](api.md#provider-availability)

Slice 7A supplies PostgreSQL quota accounting, shared quote snapshots, durable refresh intent, wallet subscriptions and fenced lease operations. Normal search, historical lookup and BUY verification use the durable budget. The queue and retry policy arrive in 7B, startup/shutdown recovery in 7C, public valuation/status endpoints in 7D, and freshness UI in 7E. No background refresh runs in 7A.

## Quota configuration

| API-only variable         | Development/test default | Meaning                                                   |
| ------------------------- | ------------------------ | --------------------------------------------------------- |
| `FMP_DAILY_REQUEST_LIMIT` | `250`                    | Maximum tracked outbound reservations per quota day       |
| `FMP_QUOTA_TIMEZONE`      | `America/New_York`       | IANA timezone defining local midnight and quote freshness |

Production with an FMP key requires both variables explicitly. `US` is ambiguous and is rejected; the deployed reset timezone must be confirmed for the target environment. The approved operational limit is 250. No provider key is needed for automated tests.

The first reservation persists one `FMP` policy in `provider_budget`. Later processes must match its limit and timezone or fail closed. There is one shared application budget per database, independent of users, wallets, symbols and API restarts. Development, CI and production must use separate databases. A coordinated policy change requires stopping dispatch, updating the persisted policy and all API configurations consistently, then restarting. Do not delete counters or change timezone during an active quota day to obtain another allowance.

`provider_quota_day` retains each day's used count. A conditional PostgreSQL upsert increments it only below the policy limit. Every search, needed profile/history follow-up and explicit retry reserves separately immediately before HTTP dispatch. Failed responses and transport errors keep their charges; there are no refunds. Missing keys and denied reservations cause no dispatch. Database/policy failures return the existing sanitized provider-unavailable result.

The calendar uses UTC instants and the configured timezone, with local-midnight resets across 23- and 25-hour daylight-saving days. A reservation belongs to the day when it is reserved; an already dispatched request is not transferred or refunded at midnight. API hosts must have synchronized clocks. The repository's remaining count describes this application's tracked reservations, not authoritative provider-account remaining quota: requests made outside this application are unknown.

## Shared quote snapshots

`price_snapshot` has a unique `(symbol, marketDate)` key and stores a positive exact `NUMERIC(30,8)` price, explicit USD currency, FMP source and UTC retrieval timestamp. Writes validate symbol/date/price precision before persistence; concurrent or delayed responses cannot replace a newer retrieval with an older one. The latest read orders by market date rather than retrieval time.

A quote successfully retrieved on the configured current day can be fresh even when its market date is an earlier trading day, such as a weekend or holiday. Yesterday's retrieval and future-dated data are not fresh. Failed or exhausted refreshes preserve the previous snapshot and its retrieval timestamp. This cache belongs to the upcoming current-quote flow. The existing bounded 60-second search and historical lookup caches retain their separate keys and behavior.

## Durable refresh work

`refresh_work` stores one row per symbol: status, request/update timestamps, lease token/expiry, attempt count, next retry time and safe failure code. `refresh_subscription` connects an owned wallet to shared work. Subscription creation checks ownership under a wallet key-share lock, coordinating with deletion. Repeated requests coalesce and preserve running leases or failed-work retry deadlines.

An atomic claim permits one worker to acquire eligible pending/failed work or an expired lease. Work without wallet subscriptions cannot be claimed. A random lease token fences completion/failure updates; an expired worker cannot write after reclamation. Successful completion and snapshot persistence commit together. Invalid snapshot writes roll back the status change. Failed work records only a stable application code and retry time, never provider bodies or credentials. Attempt counts count lease claims, while provider quota counts every actual outbound request separately.

Wallet deletion cascades its subscriptions. It preserves shared quotes, quota accounting and symbol work, including work still needed by other wallets. An already running request can finish and retain a useful shared snapshot after its original wallet is deleted. Retained orphan work cannot acquire a new lease.

These repository operations are persistence primitives. They do not yet enqueue tasks, select held symbols on wallet open, schedule retries, recover a worker, or expose prices/status to the browser. Those behaviors keep their own delivery gates.

## Migration and checks

Apply `20261020170000_cache_quota_persistence` before using durable provider dispatch. For local development, run the documented [migration workflow](local-development.md#apply-migrations-and-generate-the-client), then restart the API. Set the API-only FMP key in the ignored local environment or hosted secret manager; never use a `VITE_` key or send credentials in chat.

Tests use a disposable PostgreSQL database and controlled providers. They cover independent-client quota races, the final unit at the 250-request limit, quota-day boundaries, configuration disagreement, cache precision/uniqueness, lease races/fencing, rollback, retry deadlines, ownership and wallet cascade preservation. The authenticated historical API test also exercises the default durable-budget wiring without a live provider.
