# Pricing render isolation

F3 is addressed by moving `useWalletPricing` out of the wallet and instrument page components into dedicated pricing components. Metadata, accounting summaries and transaction history remain siblings of the pricing subtree. The quota controller also moves out of the authenticated layout into a provider with stable children. Data/refresh commands and request state use separate contexts, so request-state changes do not broadcast to consumers that only need quota data.

The wallet's holdings list and the price panel's financial metrics have shallow memo boundaries. No per-row memoization or custom prop comparator is added. A local valuation adapter retains the last successful value for the current wallet and preserves that reference when a new response contains identical data. It compares the complete validated JSON DTO once per new full-valuation result, including dates, quantities, freshness and per-holding values. It does not serialize data on every loading, quota or progress update. A changed snapshot still reaches the presentation components.

The cache is local to the pricing component, not a global query store. It retains one successful snapshot and the latest result identity. Wallet IDs are checked before displaying the value. A guarded state adjustment tracks new results during rendering, preserving the existing last-known-value fallback without an additional effect/commit. That local render retry remains deliberate; expensive ledger presentation is outside it.

## Verification

Real route objects, router fetchers and MSW responses are used in `pricing-renders.test.tsx`. Component wrappers count ledger rendering, a currency-formatting probe counts actual formatting work, and React Profiler observes the history subtree. The probes do not replace the real feature components or mock pricing hooks.

For a settled fresh wallet or instrument page, two unchanged pricing checks followed by unchanged and changed-quota reads produced:

| Work                                                       | Additional executions |
| ---------------------------------------------------------- | --------------------: |
| Transaction history component                              |                     0 |
| Ledger summary component                                   |                     0 |
| Holdings list component                                    |                     0 |
| Currency formatting in the isolated financial presentation |                     0 |

The formatting scenario uses history entries with no eligible deletion controls to distinguish this work from F4's independent dialog controllers. Another case keeps deletion controls available and verifies that the history, holdings and summary component bodies still remain stable. Changed valuations update the displayed price; explicit ledger revalidation still updates history and summaries. A held quota response verifies that loading feedback updates while data-only quota consumers do not rerender, then receive the completed data change once.

Profiler callbacks still observed small descendant updates while the history component itself and its financial formatting did no work. In one local run, the history scope observed seven callbacks on the wallet page and six on the instrument page, with individual render durations around 0.2–0.8 ms. Router subscribers within the subtree can update independently of their parent. These jsdom observations are not a production browser latency or frame-time guarantee; the regression assertions focus on the repeated application work, not timing thresholds or a promise of zero React updates.

Run the focused checks with:

```powershell
pnpm --filter @my-wallets/web exec vitest run src/app/routes/wallets/pricing-renders.test.tsx --reporter=verbose
```

Existing pricing journeys continue to cover stale values, failed reads, changed wallets, refresh failures, status polling, quota and expired sessions. Ledger journeys cover sale/deletion revalidation and form state.

Engineering review covered component responsibilities, subscription boundaries, cache lifetime, immutable DTO assumptions, callback dependencies and failure recovery. Existing shadcn compositions, markup and responsive classes are retained. No dependency, database, API contract or authorization changes are required. F4's sale-controller work is covered by [the sale editor lifecycle](sale-editor-lifecycle.md); transaction-deletion controls retain their independent controllers. F5 adds [market-day invalidation](market-data.md#browser-freshness-and-valuation). Its pricing controller consumes quota loading state to wait for the current day/budget before automatic admission; the ledger and financial formatting boundaries remain in place. The loader waterfall remains F6.
