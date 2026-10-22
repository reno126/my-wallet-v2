# Cross-feature acceptance

[Testing](testing.md) · [Project overview](../README.md)

This acceptance record covers slice 8A on 2026-10-22. It uses the disposable loopback `wallet_test` database, real Fastify and Better Auth sessions, Chromium, and controlled market-data responses. No live FMP quota or production credentials are used.

## Acceptance matrix

| Journey or invariant                                            | Evidence                                                                                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration, logout and login with real sessions               | `e2e/tests/account-isolation.spec.ts`, plus the authentication API suite                                                                                                             |
| Multiple private wallets, reload and navigation                 | Account-isolation journey; wallet lifecycle API and browser suites                                                                                                                   |
| Foreign wallet and ledger data remain unavailable               | Two browser contexts; eleven authenticated foreign reads/mutations return 404; API ownership suites                                                                                  |
| Search, explicit USD historical quote and exact purchase values | `e2e/tests/purchase-ledger.spec.ts`; controlled provider, contract and transaction suites                                                                                            |
| Fresh-cache reuse and actual request accounting                 | Purchase journey makes five provider calls through search, history, BUY verification and current-price refresh; reload adds no calls                                                 |
| Exhausted quota preserves stale values and ledger actions       | Purchase journey ages the persisted snapshot, retains the valuation, blocks further dispatch and continues SELL/deletion                                                             |
| Oversell protection and FIFO                                    | Ledger form validation, transactional concurrency tests, exact accounting tests and persisted browser sale results                                                                   |
| Latest deletion, cancellation and corrected re-entry            | Real purchase journey verifies new transaction identity and recalculated FIFO results; API tests cover ordering and conflicts                                                        |
| Wallet deletion and isolation                                   | Real account journey deletes the owner’s ledger, preserving a sibling wallet, the shared instrument and the other account’s wallet; persistence tests cover shared prices/quota/work |
| Responsive critical screens                                     | Browser suites cover 320, 375, 768, 1024 and 1440 CSS pixels, keyboard operation, dialogs, long financial values and page overflow                                                   |
| Accessible status and recovery                                  | Explicit fresh/stale/missing/exhausted labels; accessible errors, disabled pending controls, dialog focus/cancellation and navigation-preserving error boundaries                    |
| Clean migrations and quality checks                             | Guarded test-database reset, all six migrations, generated-contract checks, lint, formatting, workspace typechecks, tests, production builds and dependency audit                    |

## Verification results

The clean-database workspace run passed the browser, contracts and API suites. After correcting the demonstrated web-test races, the entire web suite passed, and lint, formatting, typechecks, tooling tests, production builds and audit were rerun successfully against the final code.

| Check                                                     | Result                         |
| --------------------------------------------------------- | ------------------------------ |
| Guarded `wallet_test` reset and migration deploy          | All six migrations applied     |
| Chromium browser suite                                    | 46 passed, none skipped        |
| Contracts suite                                           | 81 passed                      |
| API suite                                                 | 618 passed                     |
| Web suite                                                 | 249 passed                     |
| Custom ESLint rules / database reset safety               | 5 passed / 3 passed            |
| Contract drift, lint, formatting and workspace typechecks | Passed                         |
| API, web and contracts production builds                  | Passed                         |
| `pnpm audit --audit-level high`                           | No known vulnerabilities found |

## Corrections made during acceptance

- The database browser bridge now forwards `/api/` requests to a real loopback listener. It preserves native HTTP response/cookie handling and removes the late `route.fulfill` failure seen during cleanup. Only API paths are forwarded; Vite source modules under `src/lib/api` remain with Vite.
- Workspace test packages run sequentially and jsdom concurrency is bounded. The previous unbounded web run failed eighteen tests during startup and asynchronous UI work. The web test deadline allows complete user journeys. The deletion journey allows five seconds for its initial cold lazy-route import and disposes its router after each test; other query timeouts remain unchanged.
- Pricing recovery tests wait for the retry control to become enabled before clicking. A visible error or valuation does not imply that all concurrent pricing reads have finished.
- The shared input token is lighter so empty input boundaries remain distinguishable against dark form surfaces. The rendered login input border improved from about 1.45:1 to 3.63:1. Responsive browser checks require at least 3:1 against the adjacent background, following [W3C’s non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Labels, focus indicators and text statuses remain explicit.

## Visual review and reproducibility

Visual inspection covered the public login screen at 320px and 1440px, stale wallet values at 375px and 1440px, and an asset ledger with a long unbroken name at 320px. Input boundaries and keyboard focus were visible; financial values and actions remained accessible without page-level horizontal scrolling. Browser artifacts include real stale-wallet screenshots and the existing responsive pricing and ledger screenshots. Artifacts are stored under ignored `e2e/test-results`; they contain test-owned data and are not source files.

Run the documented guarded reset and migration commands in [testing](testing.md), then `pnpm ci:local`. The reset targets only `wallet_test`; it does not clear `wallet_dev`. Run Prisma-generating quality commands sequentially. A local run without `NODE_ENV=test` skips the database browser journeys explicitly.

The scenario checks are scripted browser walkthroughs, complemented by visual inspection. They are not a claim of a complete assistive-technology audit or human release approval.

## Release boundary

Production-like domain/proxy/CSP/HTTPS behavior and live Google OAuth callbacks belong to slice 8B. Production secret population, final release security review and release approval belong to slice 8C. Controlled provider responses verify application behavior without asserting access under a particular live FMP subscription.

The engineering review covers changed test lifecycle, fixture ownership, guarded database targeting, React control states, shared semantic colors and dependency boundaries. No database schema or dependency changes are required for this slice. Complete user ledgers are still replayed in memory, as documented in the accounting design; this slice does not introduce materialized accounting or change that deliberate limitation.

The web tests still emit an existing `MaxListenersExceededWarning` for mocked TLS connections. A run with `--trace-warnings` locates it in `@mswjs/interceptors`' `TlsSocketController.claim` while MSW responds to intercepted requests. This test-tool warning is recorded rather than suppressed or addressed through an unrelated dependency change.

The web production build also reports its existing entry-chunk size warning: approximately 501.40 kB minified, 152.38 kB gzip. Route splitting remains in place. This slice changes only a production color token; further bundle optimization is deferred until supported by performance measurements, and the warning threshold remains unchanged.
