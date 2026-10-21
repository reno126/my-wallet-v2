import type { z as zod } from 'zod';

import type {
  holdingSchema,
  holdingValuationSchema,
  walletHoldingsSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

import { financialDecimal } from '../domain/accounting/decimal.ts';
import type { createMarketCalendar } from '../domain/market-calendar.ts';
import { isPriceFresh, type PriceSnapshot } from '../domain/price-snapshot.ts';

type WalletHoldings = zod.infer<typeof walletHoldingsSchema>;
type Holding = zod.infer<typeof holdingSchema>;
type HoldingValuation = zod.infer<typeof holdingValuationSchema>;
type WalletValuation = zod.infer<typeof walletValuationSchema>;

export function valueWalletHoldings(
  ledger: WalletHoldings,
  prices: readonly PriceSnapshot[],
  now: Date,
  calendar: ReturnType<typeof createMarketCalendar>,
): WalletValuation {
  const bySymbol = new Map(prices.map((price) => [price.symbol, price]));
  const holdings = ledger.holdings.map((holding) =>
    valueHolding(holding, bySymbol.get(holding.symbol), now, calendar),
  );
  const freshness = walletPriceFreshness(holdings);
  const currentValue =
    freshness === 'missing'
      ? null
      : holdings
          .reduce(
            (total, holding) => total.plus(holding.currentValue ?? '0'),
            financialDecimal('0'),
          )
          .toFixed();
  const unrealizedProfitLoss =
    currentValue === null
      ? null
      : financialDecimal(currentValue).minus(ledger.remainingCostBasis).toFixed();
  for (const holding of holdings) {
    holding.allocationPercentage = percentage(holding.currentValue, currentValue);
  }
  const updates = holdings.flatMap((holding) => (holding.price ? [holding.price.retrievedAt] : []));
  return {
    ...ledger,
    holdings,
    freshness,
    currentValue,
    unrealizedProfitLoss,
    unrealizedProfitLossPercentage: percentage(unrealizedProfitLoss, ledger.remainingCostBasis),
    latestPriceUpdateAt:
      updates.length === 0
        ? null
        : updates.reduce((latest, value) => (value > latest ? value : latest)),
  };
}

function valueHolding(
  holding: Holding,
  snapshot: PriceSnapshot | undefined,
  now: Date,
  calendar: ReturnType<typeof createMarketCalendar>,
): HoldingValuation {
  const valuation: HoldingValuation = {
    ...holding,
    price: null,
    freshness: 'missing',
    currentValue: null,
    unrealizedProfitLoss: null,
    unrealizedProfitLossPercentage: null,
    allocationPercentage: null,
  };
  if (financialDecimal(holding.quantity).isZero()) {
    return {
      ...valuation,
      freshness: 'not_required',
      currentValue: '0',
      unrealizedProfitLoss: '0',
    };
  }
  if (!snapshot) {
    return valuation;
  }
  const currentValue = financialDecimal(holding.quantity).times(snapshot.unitPrice).toFixed();
  const unrealizedProfitLoss = financialDecimal(currentValue)
    .minus(holding.remainingCostBasis)
    .toFixed();
  return {
    ...valuation,
    price: {
      unitPrice: snapshot.unitPrice,
      currency: snapshot.currency,
      marketDate: snapshot.marketDate,
      retrievedAt: snapshot.retrievedAt.toISOString(),
      source: snapshot.source,
    },
    freshness: isPriceFresh(snapshot, now, calendar) ? 'fresh' : 'stale',
    currentValue,
    unrealizedProfitLoss,
    unrealizedProfitLossPercentage: percentage(unrealizedProfitLoss, holding.remainingCostBasis),
  };
}

function walletPriceFreshness(holdings: readonly Pick<HoldingValuation, 'freshness'>[]) {
  if (holdings.some((holding) => holding.freshness === 'missing')) {
    return 'missing';
  }
  if (holdings.some((holding) => holding.freshness === 'stale')) {
    return 'stale';
  }
  return holdings.some((holding) => holding.freshness === 'fresh') ? 'fresh' : 'not_required';
}

function percentage(numerator: string | null, denominator: string | null): string | null {
  if (numerator === null || denominator === null || financialDecimal(denominator).isZero()) {
    return null;
  }
  return financialDecimal(numerator).dividedBy(denominator).times('100').toFixed();
}
