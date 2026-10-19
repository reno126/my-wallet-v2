import type { z as zod } from 'zod';

import {
  type historicalPriceSchema,
  instrumentPriceParamsSchema,
  instrumentPriceQuerySchema,
} from '@my-wallets/contracts';

import type { ApiFailure } from '../http/api-failure.js';
import { mapProviderFailure } from '../http/provider-failure.ts';
import type { createFmpClient } from '../providers/fmp/client.js';
import {
  type FmpHistoricalPrice,
  fmpHistoricalPricesSchema,
  fmpHistoricalProfileSchema,
  parseHistoricalPriceJson,
} from '../providers/fmp/historical-prices.ts';
import type { Result } from '../result.js';
import {
  currentMarketDate,
  historicalWindowStart,
  previousDate,
  selectHistoricalPrice,
} from './historical-price-selection.ts';

type HistoricalPrice = zod.infer<typeof historicalPriceSchema>;
type FmpClient = ReturnType<typeof createFmpClient>;
const maximumHistoryRequests = 5;
const historicalCacheTtlMs = 60_000;
const historicalCacheMaximumEntries = 100;

export function createHistoricalPriceService(
  client: FmpClient,
  now: () => Date = () => new Date(),
) {
  const cache = new Map<string, { value: HistoricalPrice; expiresAt: number }>();
  return { quote };

  async function quote(
    symbol: string,
    requestedDate: string,
  ): Promise<Result<HistoricalPrice, ApiFailure>> {
    const params = instrumentPriceParamsSchema.safeParse({ symbol });
    const query = instrumentPriceQuerySchema.safeParse({ date: requestedDate });
    if (!params.success || !query.success || requestedDate > currentMarketDate(now())) {
      return { ok: false, error: { code: 'VALIDATION_FAILED' } };
    }

    const normalizedSymbol = symbol.toUpperCase();
    const cacheKey = JSON.stringify([normalizedSymbol, requestedDate]);
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now().getTime())
      return { ok: true, value: { ...cached.value } };
    cache.delete(cacheKey);

    const result = await fetchHistoricalPrice(client, normalizedSymbol, requestedDate, now);
    if (result.ok) {
      if (cache.size >= historicalCacheMaximumEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(cacheKey, {
        value: { ...result.value },
        expiresAt: now().getTime() + historicalCacheTtlMs,
      });
    }
    return result;
  }
}

async function fetchHistoricalPrice(
  client: FmpClient,
  symbol: string,
  requestedDate: string,
  now: () => Date,
): Promise<Result<HistoricalPrice, ApiFailure>> {
  const profileResult = await client.request({
    endpoint: 'profile',
    parameters: { symbol },
    responseSchema: fmpHistoricalProfileSchema,
  });
  if (!profileResult.ok) return { ok: false, error: mapProviderFailure(profileResult.error) };
  const profile = profileResult.value[0];
  if (!profile) return { ok: false, error: { code: 'NOT_FOUND' } };
  if (profile.symbol !== symbol) return { ok: false, error: { code: 'PROVIDER_ERROR' } };
  if (!profile.currency) return { ok: false, error: { code: 'CURRENCY_UNAVAILABLE' } };
  if (profile.currency.toUpperCase() !== 'USD')
    return { ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } };

  const earliestDate = profile.ipoDate || '0000-01-01';
  let to = requestedDate;
  if (to < earliestDate) return { ok: false, error: { code: 'PRICE_NOT_AVAILABLE' } };

  for (let attempt = 0; attempt < maximumHistoryRequests; attempt += 1) {
    const from = historicalWindowStart(to, earliestDate);
    const historyResult = await client.request({
      endpoint: 'historical-price-eod/full',
      parameters: { symbol, from, to },
      responseSchema: fmpHistoricalPricesSchema,
      parseResponse: parseHistoricalPriceJson,
    });
    if (!historyResult.ok) return { ok: false, error: mapProviderFailure(historyResult.error) };
    const rows = historyResult.value;
    const failure = validateHistoricalRows(rows, symbol);
    if (failure) return { ok: false, error: failure };
    const selected = selectHistoricalPrice(rows, from, to);
    if (selected)
      return {
        ok: true,
        value: {
          symbol,
          requestedDate,
          effectiveDate: selected.date,
          unitPrice: selected.close,
          currency: 'USD',
          source: 'FMP',
          retrievedAt: now().toISOString(),
          usedPreviousTradingDay: selected.date !== requestedDate,
        },
      };
    if (from === earliestDate) return { ok: false, error: { code: 'PRICE_NOT_AVAILABLE' } };
    to = previousDate(from);
  }
  return { ok: false, error: { code: 'PRICE_LOOKUP_INCOMPLETE' } };
}

function validateHistoricalRows(
  rows: FmpHistoricalPrice[],
  symbol: string,
): ApiFailure | undefined {
  const quotesByDate = new Map<string, string>();
  for (const row of rows) {
    if (row.symbol !== symbol) return { code: 'PROVIDER_ERROR' };
    if (row.currency && row.currency.toUpperCase() !== 'USD') return { code: 'CURRENCY_MISMATCH' };
    if (quotesByDate.has(row.date) && quotesByDate.get(row.date) !== row.close) {
      return { code: 'PROVIDER_ERROR' };
    }
    quotesByDate.set(row.date, row.close);
  }
  return undefined;
}
