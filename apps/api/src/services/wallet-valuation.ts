import type { z as zod } from 'zod';

import type {
  holdingSchema,
  holdingValuationSchema,
  walletHoldingsSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

import { financialDecimal } from '../domain/accounting/decimal.ts';
import type { createMarketCalendar } from '../domain/market-calendar.ts';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import {
  assessHoldingPrices,
  type HoldingPriceState,
  walletPriceFreshness,
} from './holding-prices.ts';

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
  const holdings = assessHoldingPrices(ledger.holdings, prices, now, calendar).map(valueHolding);
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

function valueHolding({
  holding,
  price: snapshot,
  freshness,
}: HoldingPriceState<Holding>): HoldingValuation {
  const valuation: HoldingValuation = {
    ...holding,
    price: null,
    freshness,
    currentValue: null,
    unrealizedProfitLoss: null,
    unrealizedProfitLossPercentage: null,
    allocationPercentage: null,
  };
  if (freshness === 'not_required') {
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
    currentValue,
    unrealizedProfitLoss,
    unrealizedProfitLossPercentage: percentage(unrealizedProfitLoss, holding.remainingCostBasis),
  };
}

function percentage(numerator: string | null, denominator: string | null): string | null {
  if (numerator === null || denominator === null || financialDecimal(denominator).isZero()) {
    return null;
  }
  return financialDecimal(numerator).dividedBy(denominator).times('100').toFixed();
}
