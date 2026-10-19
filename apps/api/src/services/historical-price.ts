import type { z as zod } from 'zod';

import {
  type historicalPriceSchema,
  instrumentPriceParamsSchema,
  instrumentPriceQuerySchema,
} from '@my-wallets/contracts';

import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';
import type { HistoricalClose, HistoricalPriceProvider } from './historical-price-provider.js';
import {
  historicalWindowStart,
  previousDate,
  selectHistoricalPrice,
} from './historical-price-selection.ts';
import { currentMarketDate } from './market-date.ts';

type HistoricalPrice = zod.infer<typeof historicalPriceSchema>;
const maximumHistoryWindows = 5;
const historicalCacheTtlMs = 60_000;
const historicalCacheMaximumEntries = 100;

export function createHistoricalPriceService(
  provider: HistoricalPriceProvider,
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
    if (!params.success || !query.success || query.data.date > currentMarketDate(now())) {
      return { ok: false, error: { code: 'VALIDATION_FAILED' } };
    }

    const normalizedSymbol = params.data.symbol.toUpperCase();
    const date = query.data.date;
    const cacheKey = JSON.stringify([normalizedSymbol, date]);
    const cached = getCachedQuote(cacheKey);
    if (cached) return { ok: true, value: cached };

    const profileResult = await provider.getProfile(normalizedSymbol);
    if (!profileResult.ok) return profileResult;
    const profile = profileResult.value;
    if (!profile.currency) return { ok: false, error: { code: 'CURRENCY_UNAVAILABLE' } };
    if (profile.currency.toUpperCase() !== 'USD')
      return { ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } };

    const selected = await findHistoricalClose(provider, {
      symbol: normalizedSymbol,
      requestedDate: date,
      earliestDate: profile.ipoDate || '0000-01-01',
    });
    if (!selected.ok) return selected;

    const value = toHistoricalPrice(normalizedSymbol, date, selected.value, now());
    cacheQuote(cacheKey, value);
    return { ok: true, value };
  }

  function getCachedQuote(key: string): HistoricalPrice | undefined {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now().getTime()) return { ...cached.value };
    cache.delete(key);
    return undefined;
  }

  function cacheQuote(key: string, value: HistoricalPrice): void {
    if (cache.size >= historicalCacheMaximumEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, {
      value: { ...value },
      expiresAt: now().getTime() + historicalCacheTtlMs,
    });
  }
}

async function findHistoricalClose(
  provider: HistoricalPriceProvider,
  input: { symbol: string; requestedDate: string; earliestDate: string },
): Promise<Result<HistoricalClose, ApiFailure>> {
  const { symbol, requestedDate, earliestDate } = input;
  let windowEndDate = requestedDate;
  if (windowEndDate < earliestDate) return { ok: false, error: { code: 'PRICE_NOT_AVAILABLE' } };

  for (let windowIndex = 0; windowIndex < maximumHistoryWindows; windowIndex += 1) {
    const windowStartDate = historicalWindowStart(windowEndDate, earliestDate);
    const historyResult = await provider.getHistory({
      symbol,
      from: windowStartDate,
      to: windowEndDate,
      expectedCurrency: 'USD',
    });
    if (!historyResult.ok) return historyResult;
    const selected = selectHistoricalPrice(historyResult.value, windowStartDate, windowEndDate);
    if (selected) return { ok: true, value: selected };
    if (windowStartDate === earliestDate)
      return { ok: false, error: { code: 'PRICE_NOT_AVAILABLE' } };
    windowEndDate = previousDate(windowStartDate);
  }
  return { ok: false, error: { code: 'PRICE_LOOKUP_INCOMPLETE' } };
}

function toHistoricalPrice(
  symbol: string,
  requestedDate: string,
  selected: HistoricalClose,
  retrievedAt: Date,
): HistoricalPrice {
  return {
    symbol,
    requestedDate,
    effectiveDate: selected.date,
    unitPrice: selected.close,
    currency: 'USD',
    source: 'FMP',
    retrievedAt: retrievedAt.toISOString(),
    usedPreviousTradingDay: selected.date !== requestedDate,
  };
}
