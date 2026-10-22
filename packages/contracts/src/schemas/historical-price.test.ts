import { describe, expect, it } from 'vitest';

import {
  historicalPriceSchema,
  instrumentPriceParamsSchema,
  instrumentPriceQuerySchema,
} from './instrument.js';

const price = {
  symbol: 'AAPL',
  requestedDate: '2026-10-18',
  effectiveDate: '2026-10-16',
  unitPrice: '190.12345678',
  currency: 'USD',
  source: 'FMP',
  retrievedAt: '2026-10-19T16:00:00.000Z',
  usedPreviousTradingDay: true,
};

describe('when validating historical quote contracts', () => {
  it('should accept explicit USD and exact-decimal price metadata', () => {
    // Arrange
    // Act
    const result = historicalPriceSchema.safeParse(price);

    // Assert
    expect(result.success).toBe(true);
  });

  it.each([
    { unitPrice: 190.12345678 },
    { unitPrice: '0' },
    { unitPrice: '-1' },
    { unitPrice: '190.123456789' },
    { currency: 'EUR' },
    { currency: undefined },
    { source: 'UNKNOWN' },
    { effectiveDate: '2026-02-30' },
  ])('should reject unsafe quote values: %j', (changes) => {
    // Arrange
    // Act
    const result = historicalPriceSchema.safeParse({ ...price, ...changes });

    // Assert
    expect(result.success).toBe(false);
  });

  it.each([
    {},
    { date: '2026-02-30', currency: 'USD' },
    { date: '2026-10-18T00:00:00Z', currency: 'USD' },
    { date: ['2026-10-18'], currency: 'USD' },
    { date: '2026-10-18' },
    { date: '2026-10-18', currency: 'EUR' },
    { date: '2026-10-18', currency: '' },
    { date: '2026-10-18', currency: ['USD'] },
  ])('should reject invalid price queries: %j', (input) => {
    // Arrange
    // Act
    const result = instrumentPriceQuerySchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should accept a trade date with explicit USD currency', () => {
    // Arrange
    const query = { date: '2026-10-18', currency: 'USD' };
    // Act
    const result = instrumentPriceQuerySchema.safeParse(query);
    // Assert
    expect(result.success).toBe(true);
  });

  it.each(['AAPL', 'BRK-B', 'BRK.B'])('should accept an instrument symbol %s', (symbol) => {
    // Arrange
    // Act
    const result = instrumentPriceParamsSchema.safeParse({ symbol });

    // Assert
    expect(result.success).toBe(true);
  });

  it.each(['', '../AAPL', 'AAPL,MSFT', 'A'.repeat(41)])(
    'should reject an invalid instrument symbol %s',
    (symbol) => {
      // Arrange
      // Act
      const result = instrumentPriceParamsSchema.safeParse({ symbol });

      // Assert
      expect(result.success).toBe(false);
    },
  );
});
