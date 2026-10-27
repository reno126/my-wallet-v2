# Sale editor lifecycle

F4 replaces each holding's eager sale form/controller with a lightweight trigger and one shared sale mutation controller per holdings view. The selected row mounts the editor. The instrument page uses the same provider, keyed by wallet and symbol to retain existing navigation isolation.

The shared controller owns selection, open state and the existing transaction outcome handling. Its context value and handlers are stable during unrelated pricing/quota requests. Each row retains its own Radix Dialog root/trigger so normal dialog focus handling returns to the activated row. No custom focus manager, dialog primitive or styling system is added.

| State                                    | Sale forms mounted | Behavior                                                         |
| ---------------------------------------- | -----------------: | ---------------------------------------------------------------- |
| No selection, including closed positions |                  0 | Only triggers and one shared mutation controller                 |
| Selected position open                   |                  1 | Uses that holding's current quantity and symbol                  |
| Cancelled, with no uncertain result      |                  0 | Discards the draft; next selection starts fresh                  |
| Pending submission                       |                  1 | Prevents cancellation, Escape and repeated submission            |
| Unconfirmed result, open or closed       |                  1 | Retains values/outcome; blocks switching to another holding      |
| Success                                  |                  0 | Closes the editor; normal router revalidation updates the ledger |

An unconfirmed editor is retained while its portal is closed. Reopening cannot clear its failure or enable another submission. Explicit ledger recovery clears the uncertainty without retrying the mutation. If a later read reports the selected position closed, its trigger still permits reviewing the uncertain outcome; it does not enable a sale. After recovery, the closed-position trigger is disabled normally.

Form schema/resolver creation is memoized by available quantity. Default trade date is created once per editor session. Refreshing the same holding updates validation/availability while retaining entered values. The shared mutation hook's result is memoized so unrelated fetcher updates do not broadcast to every trigger through context.

## Verification

`sale-editor.test.tsx` uses real routes, form validation and fetchers with controlled API responses. Instrumentation delegates to the real schema/controller while recording their initialization:

- With 80 holdings, including 40 closed positions: zero sale schemas before opening, one shared sale mutation-controller mount, and no extra initialization after pricing/quota checks.
- Selecting a row: one schema for its quantity and one visible editor; background quota checks do not recreate the schema. Closing returns focus to that trigger.
- Cancelling and choosing another holding: resets fields and uses the new quantity limit and submitted symbol.
- Confirmed rejection: does not leak the previous position's error into a new editor.
- Unconfirmed result: retains values and blocks switching/resubmission across close/reopen; recovery does not dispatch another sale.
- A position becoming closed: still allows uncertainty recovery and then disables new sales.
- A held submission: disables cancellation, Escape and peer sale triggers until the result settles.

Existing ledger journeys cover exact submission values, chronological-oversell rejection, navigation between wallets/instruments, holding refresh, successful revalidation, and transaction deletion. Pricing-render tests continue to verify F3's component boundaries.

```powershell
pnpm --filter @my-wallets/web exec vitest run src/app/routes/wallets/sale-editor.test.tsx src/app/routes/wallets/ledger-journey.test.tsx src/app/routes/wallets/pricing-renders.test.tsx
```

The initialization scenario excludes transaction-deletion controls to isolate sale-controller work. Deletion controls retain their independent controllers and are bounded by history pagination; this change does not combine those operations with the sale workflow. Holding cards and lightweight dialog roots still scale with the number of holdings; list virtualization/pagination is not introduced without a separate UI/data requirement.

Engineering review covered component responsibilities, context stability, callback dependencies, focus restoration, quantity changes and pending/unconfirmed outcomes. API ownership, authoritative oversell validation, cancellation and immutable persistence are unchanged. No dependency, API contract, database or migration change is required. The editor state is view-local and does not add server idempotency or persistence across page reloads. F5/F6 remain separate work.
