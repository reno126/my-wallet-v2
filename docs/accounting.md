# Financial calculation core

[Project overview](../README.md)

Slice 6A provides pure API-side accounting functions in [`apps/api/src/domain/accounting`](../apps/api/src/domain/accounting). They do not read the database, call providers, use the clock, or mutate the supplied ledger. Slice 6B integrates them into BUY/SELL persistence: the repository locks the owned wallet, inserts the candidate trade, then replays its complete symbol ledger before committing. Oversells trigger transaction rollback and return a safe conflict result. Atomic latest-delete/replay follows in 6C, ledger read endpoints in 6D, and the UI in 6E.

## Position replay

`calculatePosition(scope, entries)` accepts one wallet/instrument scope with explicit currency and the complete ledger for that position. Each entry carries its identifier, BUY/SELL side, date-only transaction date, UTC creation timestamp as a `Date`, quantity, and unit price. Quantities and prices are decimal strings with the same bounds as transaction inputs: positive, at most 22 integer digits and 8 fractional digits. Only USD is supported. Entries from another wallet or instrument, duplicate identifiers, malformed dates, and unsupported decimal inputs are rejected.

Replay sorts a copy of the ledger by transaction date, creation timestamp, then identifier in ascending order. Identifier comparison uses lexical ordering without locale rules; persisted UUIDs must retain their canonical representation. There is no BUY-before-SELL preference for tied dates/timestamps. Later slices must use this same total ordering for latest-entry eligibility.

Each BUY opens a lot at its original acquisition unit price. Each SELL consumes the oldest remaining lots and calculates:

- Proceeds = sold quantity × sale unit price.
- FIFO cost basis = sum of matched quantities × their original lot unit prices.
- Realized profit/loss = proceeds − FIFO cost basis.
- Remaining cost basis = sum of remaining lot quantities × their original unit prices.
- Weighted-average unit cost = remaining cost basis ÷ remaining quantity, or `null` when flat.

The average describes the original acquisition cost of the remaining inventory. It never determines FIFO matching or realized profit/loss. Realized results accumulate across closing and reopening a position. The result includes remaining lots and each sale's accounting, with explicit USD currency and plain decimal strings. No current-price valuation is performed.

A SELL exceeding inventory at its chronological position returns `INSUFFICIENT_HOLDING`, even if a later BUY would cover it. Other expected failures use `UNSUPPORTED_CURRENCY`, `LEDGER_SCOPE_MISMATCH`, or `INVALID_LEDGER_ENTRY` through the shared `Result` type. The repository and service own authorization, database locking, atomic writes, and the HTTP conflict mapping; the calculation remains independent of those concerns. Replaying a supplied ledger does not itself authorize deletion or enforce latest-only deletion.

## Decimal precision and presentation

The core uses Prisma's existing Decimal runtime with a private cloned context: 100 significant digits and `ROUND_HALF_UP`. It does not change the shared Decimal configuration or introduce another dependency. A supported input has at most 30 significant digits; multiplying two inputs requires at most 60. Even a ledger at JavaScript's maximum array length adds fewer than 10 digits to a sum, so 100 digits preserve all intermediate products, lot allocations, and sums exactly.

Division is confined to weighted-average unit cost. Non-terminating averages are approximated to 100 significant digits, providing more than 18 fractional digits throughout the supported price range. Exact remaining cost basis and quantity are retained separately. Decimal strings use fixed notation without exponent conversion or JavaScript `number` conversion.

Presentation helpers apply the canonical display policy: `formatUsdAmount` uses 2 decimal places, `formatUsdUnitPrice` uses 4, and `formatShareQuantity` uses at most 6 with trailing zeros trimmed. Ties round away from zero, including negative profit/loss; rounded zero has no negative sign. Monetary helper inputs carry `currency: 'USD'`. Invalid plain-decimal strings and negative share quantities throw `RangeError`. These helpers return numeric text without currency symbols or grouping. Formatting is a separate step and never feeds back into accounting; future API read models must preserve their full decimal-string values.

Unit tests cover multiple and fractional lots, maximum-sized exact multiplication and sums, repeating division, chronological oversells, deterministic ordering, removal/re-entry replay, input immutability and validation, isolated Decimal settings, and positive/negative half-way display rounding. See [testing](testing.md) for the verification workflow.
