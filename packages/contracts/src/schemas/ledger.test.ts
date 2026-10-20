import { describe, expect, it } from 'vitest';

import { holdingSchema, walletHoldingsSchema } from './ledger.js';
import { transactionListQuerySchema } from './transaction.js';

const holding = {
  walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
  symbol: 'AAPL',
  name: 'Apple',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
  quantity: '0.00000001',
  remainingCostBasis: '99999999999999999999999999999999999999.0000000000000001',
  averageUnitCost: '13.33333333333333333333333333333333333333333333333333',
  realizedProfitLoss: '-0.0000000000000001',
  lastTransactionDate: '2026-10-18',
};

describe('when validating ledger read contracts', () => {
  it('should preserve derived precision and closed-position realized losses', () => {
    // Arrange
    const closed = { ...holding, quantity: '0', remainingCostBasis: '0', averageUnitCost: null };
    // Assert
    expect(holdingSchema.parse(holding)).toEqual(holding);
    expect(holdingSchema.parse(closed)).toEqual(closed);
    expect(
      walletHoldingsSchema.safeParse({
        walletId: holding.walletId,
        reportingCurrency: 'USD',
        remainingCostBasis: '0',
        realizedProfitLoss: '0',
        lastTransactionDate: null,
        holdings: [],
      }).success,
    ).toBe(true);
  });

  it.each([
    { quantity: 1 },
    { quantity: '-1' },
    { remainingCostBasis: '-1' },
    { averageUnitCost: '1e-8' },
    { realizedProfitLoss: 'NaN' },
    { quoteCurrency: 'EUR' },
    { currentValue: '100' },
  ])('should reject lossy or unsupported holding fields: %j', (changes) => {
    // Assert
    expect(holdingSchema.safeParse({ ...holding, ...changes }).success).toBe(false);
  });

  it('should default and bound history pagination with an optional symbol', () => {
    // Assert
    expect(transactionListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(
      transactionListQuerySchema.parse({ page: '2', pageSize: '100', symbol: 'aapl' }),
    ).toEqual({ page: 2, pageSize: 100, symbol: 'aapl' });
    for (const query of [
      { page: '0' },
      { pageSize: '101' },
      { symbol: 'AAPL/MSFT' },
      { userId: 'other' },
    ]) {
      expect(transactionListQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
