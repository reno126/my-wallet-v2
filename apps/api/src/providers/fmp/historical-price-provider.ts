import type { ApiFailure } from '../../http/api-failure.js';
import { mapProviderFailure } from '../../http/provider-failure.ts';
import type { Result } from '../../result.js';
import type {
  HistoricalClose,
  HistoricalInstrumentProfile,
  HistoricalPriceProvider,
  HistoricalPriceWindow,
} from '../../services/historical-price-provider.js';
import type { createFmpClient } from './client.js';
import {
  type FmpHistoricalPrice,
  fmpHistoricalPricesSchema,
  fmpHistoricalProfileSchema,
  parseHistoricalPriceJson,
} from './historical-prices.ts';

export function createFmpHistoricalPriceProvider(
  client: ReturnType<typeof createFmpClient>,
): HistoricalPriceProvider {
  return { getProfile, getHistory };

  async function getProfile(
    symbol: string,
  ): Promise<Result<HistoricalInstrumentProfile, ApiFailure>> {
    const result = await client.request({
      endpoint: 'profile',
      parameters: { symbol },
      responseSchema: fmpHistoricalProfileSchema,
    });
    if (!result.ok) return { ok: false, error: mapProviderFailure(result.error) };
    const profile = result.value[0];
    if (!profile) return { ok: false, error: { code: 'NOT_FOUND' } };
    if (profile.symbol !== symbol) return { ok: false, error: { code: 'PROVIDER_ERROR' } };
    return {
      ok: true,
      value: { currency: profile.currency ?? null, ipoDate: profile.ipoDate || null },
    };
  }

  async function getHistory(
    window: HistoricalPriceWindow,
  ): Promise<Result<HistoricalClose[], ApiFailure>> {
    const { symbol, from, to, expectedCurrency } = window;
    const result = await client.request({
      endpoint: 'historical-price-eod/full',
      parameters: { symbol, from, to },
      responseSchema: fmpHistoricalPricesSchema,
      parseResponse: parseHistoricalPriceJson,
    });
    if (!result.ok) return { ok: false, error: mapProviderFailure(result.error) };
    const failure = validateHistoricalRows(result.value, symbol, expectedCurrency);
    if (failure) return { ok: false, error: failure };
    return {
      ok: true,
      value: result.value.map(({ date, close }) => ({ date, close })),
    };
  }
}

function validateHistoricalRows(
  rows: FmpHistoricalPrice[],
  symbol: string,
  expectedCurrency: string,
): ApiFailure | undefined {
  const quotesByDate = new Map<string, string>();
  for (const row of rows) {
    if (row.symbol !== symbol) return { code: 'PROVIDER_ERROR' };
    if (row.currency && row.currency.toUpperCase() !== expectedCurrency)
      return { code: 'CURRENCY_MISMATCH' };
    if (quotesByDate.has(row.date) && quotesByDate.get(row.date) !== row.close) {
      return { code: 'PROVIDER_ERROR' };
    }
    quotesByDate.set(row.date, row.close);
  }
  return undefined;
}
