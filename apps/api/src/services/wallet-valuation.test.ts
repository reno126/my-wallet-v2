import { describe, expect, it } from 'vitest';
import type { z as zod } from 'zod';

import { holdingSchema, walletHoldingsSchema, walletValuationSchema } from '@my-wallets/contracts';

import { createMarketCalendar } from '../domain/market-calendar.ts';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import { valueWalletHoldings } from './wallet-valuation.ts';

const now = new Date('2026-11-02T17:00:00.000Z');
const calendar = createMarketCalendar('America/New_York');
const holding: zod.infer<typeof holdingSchema> = {
  walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
  symbol: 'AAPL',
  name: 'Apple',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
  quantity: '2',
  remainingCostBasis: '20',
  averageUnitCost: '10',
  realizedProfitLoss: '5',
  lastTransactionDate: '2026-10-18',
};
const price: PriceSnapshot = {
  symbol: 'AAPL',
  unitPrice: '15',
  currency: 'USD',
  source: 'FMP',
  marketDate: '2026-11-02',
  retrievedAt: now,
};

function wallet(holdings = [holding], cost = '20'): zod.infer<typeof walletHoldingsSchema> {
  return {
    walletId: holding.walletId,
    reportingCurrency: 'USD',
    holdings,
    remainingCostBasis: cost,
    realizedProfitLoss: '5',
    lastTransactionDate: holdings.length ? '2026-10-18' : null,
  };
}

describe('when valuing ledger holdings with cached prices', () => {
  it('should calculate current value and unrealized P/L from remaining FIFO cost without changing realized results', () => {
    // Act
    const result = valueWalletHoldings(wallet(), [price], now, calendar);
    // Assert
    expect(walletValuationSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      currentValue: '30',
      unrealizedProfitLoss: '10',
      unrealizedProfitLossPercentage: '50',
      realizedProfitLoss: '5',
      freshness: 'fresh',
      latestPriceUpdateAt: now.toISOString(),
    });
    expect(result.holdings[0]).toMatchObject({
      currentValue: '30',
      unrealizedProfitLoss: '10',
      allocationPercentage: '100',
      price: { unitPrice: '15', currency: 'USD', marketDate: price.marketDate },
    });
  });

  it('should keep stale prices usable and expose the original retrieval time', () => {
    // Arrange
    const retrievedAt = new Date('2026-11-01T17:00:00Z');
    // Act
    const result = valueWalletHoldings(
      wallet(),
      [{ ...price, marketDate: '2026-10-30', retrievedAt }],
      now,
      calendar,
    );
    // Assert
    expect(result).toMatchObject({
      currentValue: '30',
      freshness: 'stale',
      latestPriceUpdateAt: retrievedAt.toISOString(),
    });
    expect(result.holdings[0]?.freshness).toBe('stale');
  });

  it('should leave incomplete wallet totals and allocations null while preserving known position values', () => {
    // Arrange
    const ledger = wallet([holding, { ...holding, symbol: 'MSFT' }], '40');
    // Act
    const result = valueWalletHoldings(ledger, [price], now, calendar);
    // Assert
    expect(result).toMatchObject({
      currentValue: null,
      unrealizedProfitLoss: null,
      unrealizedProfitLossPercentage: null,
      remainingCostBasis: '40',
      freshness: 'missing',
    });
    expect(result.holdings[0]).toMatchObject({ currentValue: '30', allocationPercentage: null });
    expect(result.holdings[1]).toMatchObject({
      price: null,
      currentValue: null,
      unrealizedProfitLoss: null,
      allocationPercentage: null,
      freshness: 'missing',
    });
  });

  it('should value empty and closed wallets at zero without requiring any prices', () => {
    // Arrange
    const closed = { ...holding, quantity: '0', remainingCostBasis: '0', averageUnitCost: null };
    // Act
    const empty = valueWalletHoldings(wallet([], '0'), [], now, calendar);
    const result = valueWalletHoldings(wallet([closed], '0'), [price], now, calendar);
    // Assert
    for (const value of [empty, result]) {
      expect(value).toMatchObject({
        freshness: 'not_required',
        currentValue: '0',
        unrealizedProfitLoss: '0',
        unrealizedProfitLossPercentage: null,
        latestPriceUpdateAt: null,
        realizedProfitLoss: '5',
      });
    }
    expect(result.holdings[0]).toMatchObject({
      price: null,
      currentValue: '0',
      unrealizedProfitLoss: '0',
      allocationPercentage: null,
      freshness: 'not_required',
    });
  });

  it('should preserve exact fractional products and values beyond safe integers', () => {
    // Arrange
    const quantity = '9999999999999999999999.99999999';
    const large = { ...holding, quantity, remainingCostBasis: '1' };
    const tiny = {
      ...holding,
      symbol: 'TINY',
      quantity: '0.00000001',
      remainingCostBasis: '0.0000000000000002',
    };
    // Act
    const result = valueWalletHoldings(
      wallet([large, tiny], '1.0000000000000002'),
      [
        { ...price, unitPrice: quantity },
        { ...price, symbol: 'TINY', unitPrice: '0.00000001' },
      ],
      now,
      calendar,
    );
    // Assert
    expect(result.currentValue).toBe(
      '99999999999999999999999999999800000000000000.0000000000000002',
    );
    expect(result.holdings[1]).toMatchObject({
      currentValue: '0.0000000000000001',
      unrealizedProfitLoss: '-0.0000000000000001',
      unrealizedProfitLossPercentage: '-50',
    });
  });

  it('should calculate allocation and retain division precision without using display-rounded amounts', () => {
    // Arrange
    const ledger = wallet(
      [
        { ...holding, quantity: '1', remainingCostBasis: '3' },
        { ...holding, symbol: 'MSFT', quantity: '2', remainingCostBasis: '2' },
      ],
      '5',
    );
    // Act
    const result = valueWalletHoldings(
      ledger,
      [
        { ...price, unitPrice: '1' },
        { ...price, symbol: 'MSFT', unitPrice: '1' },
      ],
      now,
      calendar,
    );
    // Assert
    expect(result.holdings[0]?.allocationPercentage).toMatch(/^33\.333333333333333333333333333333/);
    expect(result.holdings[0]?.unrealizedProfitLossPercentage).toMatch(
      /^-66\.666666666666666666666666666666/,
    );
    expect(result).toMatchObject({
      currentValue: '3',
      unrealizedProfitLoss: '-2',
      unrealizedProfitLossPercentage: '-40',
    });
  });

  it('should apply the configured freshness day and accept an earlier trading date', () => {
    // Arrange
    const sunday = new Date('2026-11-02T04:30:00Z');
    const snapshot = {
      ...price,
      marketDate: '2026-10-30',
      retrievedAt: new Date('2026-11-02T04:00:00Z'),
    };
    // Act
    const result = valueWalletHoldings(wallet(), [snapshot], sunday, calendar);
    const future = valueWalletHoldings(
      wallet(),
      [{ ...snapshot, retrievedAt: now }],
      sunday,
      calendar,
    );
    // Assert
    expect(result.freshness).toBe('fresh');
    expect(future.freshness).toBe('stale');
  });
});
