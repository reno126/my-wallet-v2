import type { z as zod } from 'zod';

import type { priceFreshnessSchema } from '@my-wallets/contracts';

import { financialDecimal } from '../domain/accounting/decimal.ts';
import type { createMarketCalendar } from '../domain/market-calendar.ts';
import { isPriceFresh, type PriceSnapshot } from '../domain/price-snapshot.ts';

type PriceFreshness = zod.infer<typeof priceFreshnessSchema>;

export interface HoldingPriceState<Holding> {
  holding: Holding;
  price: PriceSnapshot | null;
  freshness: PriceFreshness;
}

export function assessHoldingPrices<Holding extends { symbol: string; quantity: string }>(
  holdings: readonly Holding[],
  prices: readonly PriceSnapshot[],
  now: Date,
  calendar: ReturnType<typeof createMarketCalendar>,
): HoldingPriceState<Holding>[] {
  const bySymbol = new Map(prices.map((price) => [price.symbol, price]));
  return holdings.map((holding) => {
    if (financialDecimal(holding.quantity).isZero()) {
      return { holding, price: null, freshness: 'not_required' };
    }
    const price = bySymbol.get(holding.symbol) ?? null;
    if (!price) {
      return { holding, price, freshness: 'missing' };
    }
    return { holding, price, freshness: isPriceFresh(price, now, calendar) ? 'fresh' : 'stale' };
  });
}

export function walletPriceFreshness(
  holdings: readonly { freshness: PriceFreshness }[],
): PriceFreshness {
  if (holdings.some((holding) => holding.freshness === 'missing')) {
    return 'missing';
  }
  if (holdings.some((holding) => holding.freshness === 'stale')) {
    return 'stale';
  }
  return holdings.some((holding) => holding.freshness === 'fresh') ? 'fresh' : 'not_required';
}
