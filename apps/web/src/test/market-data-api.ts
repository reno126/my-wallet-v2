import { http, HttpResponse } from 'msw';
import type { z as zod } from 'zod';

import type {
  providerQuotaStatusSchema,
  walletRefreshStatusSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

type ProviderQuota = zod.infer<typeof providerQuotaStatusSchema>;
type WalletRefreshStatus = zod.infer<typeof walletRefreshStatusSchema>;
type WalletValuation = zod.infer<typeof walletValuationSchema>;

import { ledgerHolding, walletHoldings } from './ledger-api';
import { walletSummary } from './wallet-api';

export const providerQuota: ProviderQuota = {
  provider: 'FMP',
  configured: true,
  quotaDate: '2026-01-19',
  timeZone: 'America/New_York',
  limit: 250,
  used: 10,
  remaining: 240,
  exhausted: false,
  resetsAt: '2026-01-20T05:00:00Z',
};

export function priceValuation(
  freshness: 'fresh' | 'stale' | 'missing' | 'not_required' = 'stale',
): WalletValuation {
  const missing = freshness === 'missing';
  const closed = freshness === 'not_required';
  const price =
    missing || closed
      ? null
      : {
          unitPrice: '20',
          currency: 'USD' as const,
          marketDate: '2026-01-16',
          retrievedAt: '2026-01-16T21:00:00Z',
          source: 'FMP' as const,
        };
  const fields = {
    currentValue: missing ? null : closed ? '0' : '30',
    unrealizedProfitLoss: missing ? null : closed ? '0' : '15',
    unrealizedProfitLossPercentage: missing || closed ? null : '100',
    freshness,
  };
  return {
    ...walletHoldings(),
    ...fields,
    latestPriceUpdateAt: price?.retrievedAt ?? null,
    holdings: [
      {
        ...ledgerHolding,
        ...fields,
        ...(closed ? { quantity: '0', remainingCostBasis: '0', averageUnitCost: null } : {}),
        price,
        allocationPercentage: missing || closed ? null : '100',
      },
    ],
  };
}

export function refreshStatus(
  freshness: WalletRefreshStatus['freshness'] = 'stale',
): WalletRefreshStatus {
  return {
    walletId: walletSummary.id,
    providerConfigured: true,
    freshness,
    hasPendingWork: false,
    holdings: [
      {
        symbol: ledgerHolding.symbol,
        freshness,
        status: 'idle',
        nextAttemptAt: null,
        lastFailureCode: null,
      },
    ],
  };
}

export function unavailablePricingHandlers(apiBase: string) {
  return [
    http.get(`${apiBase}/market-data/quota`, () =>
      HttpResponse.json({ ...providerQuota, configured: false }),
    ),
    http.get(
      `${apiBase}/wallets/:walletId/valuation`,
      () => new HttpResponse(null, { status: 503 }),
    ),
    http.get(
      `${apiBase}/wallets/:walletId/price-refresh`,
      () => new HttpResponse(null, { status: 503 }),
    ),
  ];
}
