export const pricingDictionary = {
  title: 'Market values',
  loading: 'Loading cached market values…',
  unavailable: 'Market values could not be loaded. Your ledger is still available.',
  refresh: 'Refresh prices',
  retry: 'Check prices again',
  requesting: 'Requesting a price refresh…',
  pending: 'Price refresh pending. Cached values remain available.',
  running: 'Updating prices. Cached values remain available.',
  paused: 'Automatic checks have paused. Check again for updated prices.',
  failed: 'Some prices could not be refreshed. Last known values are shown.',
  refreshFailed: 'The refresh request could not be confirmed. Check prices before trying again.',
  limited: 'Price requests are temporarily limited. Try again later.',
  providerUnavailable: 'Price updates are unavailable. Last known values are shown.',
  exhausted:
    'The shared request budget is exhausted. Values use last known prices, which may be stale.',
  stale: 'Values use stale prices. Check each asset’s price date.',
  missing:
    'Some prices are missing. Complete wallet totals and allocation percentages are unavailable.',
  noPrice: 'Unavailable',
  currentValue: 'Current value',
  unrealized: 'Unrealized profit / loss',
  unrealizedPercentage: 'Unrealized return',
  allocation: 'Share of wallet value',
  unitPrice: 'Latest unit price',
  marketDate: 'Price market date',
  updatedAt: 'Price retrieved',
  freshness: {
    fresh: 'Fresh prices',
    stale: 'Stale prices',
    missing: 'Missing prices',
    not_required: 'No price required',
  },
  quota: {
    title: 'Shared market-data budget',
    loading: 'Checking the shared market-data budget…',
    unavailable: 'Shared market-data budget status is unavailable.',
    disabled: 'Market-data provider is not configured.',
    warning: 'The shared request budget is running low.',
    tracked: 'Based on requests tracked by this app; this is not the provider account balance.',
    resets: 'Resets',
    details: 'Budget details',
  },
} as const;

export function quotaRemaining(remaining: number, limit: number) {
  return `${remaining} of ${limit} tracked requests remaining`;
}
