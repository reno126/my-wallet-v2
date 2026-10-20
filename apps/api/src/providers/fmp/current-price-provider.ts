import { z as zod } from 'zod';

import type { createMarketCalendar } from '../../domain/market-calendar.ts';
import { mapProviderFailure } from '../../http/provider-failure.ts';
import { failure, success } from '../../result.ts';
import { normalizedInstrumentSymbolSchema } from '../../schemas/instrument-symbol.ts';
import type {
  CurrentPriceProvider,
  RefreshFailure,
} from '../../services/current-price-provider.ts';
import type { createFmpClient, FmpFailure } from './client.ts';
import { exactPriceSchema, parseExactPriceJson } from './exact-price.ts';
import { fmpProfileResponseSchema } from './instruments.ts';

const quotesSchema = zod
  .array(
    zod.object({
      symbol: normalizedInstrumentSymbolSchema,
      price: exactPriceSchema,
      timestamp: zod.number().int().positive().max(253402300799),
      currency: zod
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/)
        .nullish(),
    }),
  )
  .max(1);

export function createFmpCurrentPriceProvider(
  client: ReturnType<typeof createFmpClient>,
  marketCalendar: ReturnType<typeof createMarketCalendar>,
  now: () => Date = () => new Date(),
): CurrentPriceProvider {
  return { getQuote };

  async function getQuote(symbol: string): ReturnType<CurrentPriceProvider['getQuote']> {
    const profileResult = await client.request({
      endpoint: 'profile',
      parameters: { symbol },
      responseSchema: fmpProfileResponseSchema,
    });
    if (!profileResult.ok) {
      return failure(refreshFailure(profileResult.error));
    }
    const profile = profileResult.value[0];
    if (!profile) {
      return failure({ code: 'PRICE_NOT_AVAILABLE', retryable: false });
    }
    if (profile.symbol !== symbol) {
      return failure({ code: 'PROVIDER_ERROR', retryable: false });
    }
    if (!profile.currency) {
      return failure({ code: 'CURRENCY_UNAVAILABLE', retryable: false });
    }
    if (profile.currency.toUpperCase() !== 'USD') {
      return failure({ code: 'UNSUPPORTED_CURRENCY', retryable: false });
    }
    const quoteResult = await client.request({
      endpoint: 'quote',
      parameters: { symbol },
      responseSchema: quotesSchema,
      parseResponse: (text) => parseExactPriceJson(text, 'price'),
    });
    if (!quoteResult.ok) {
      return failure(refreshFailure(quoteResult.error));
    }
    const quote = quoteResult.value[0];
    if (!quote) {
      return failure({ code: 'PRICE_NOT_AVAILABLE', retryable: false });
    }
    const retrievedAt = now();
    const marketInstant = new Date(quote.timestamp * 1000);
    if (quote.symbol !== symbol || marketInstant > retrievedAt) {
      return failure({ code: 'PROVIDER_ERROR', retryable: false });
    }
    if (quote.currency && quote.currency.toUpperCase() !== 'USD') {
      return failure({ code: 'CURRENCY_MISMATCH', retryable: false });
    }
    return success({
      marketDate: marketCalendar.date(marketInstant),
      unitPrice: quote.price,
      currency: 'USD',
      source: 'FMP',
      retrievedAt,
    });
  }
}

function refreshFailure(error: FmpFailure): RefreshFailure {
  return {
    code: mapProviderFailure(error).code,
    retryable:
      error.code === 'NETWORK_ERROR' ||
      error.code === 'TIMEOUT' ||
      (error.code === 'HTTP_ERROR' && (error.status === 429 || error.status >= 500)),
  };
}
