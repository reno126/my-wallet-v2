import { describe, expect, it } from 'vitest';

import { createBuyTransactionSchema } from './transaction.js';

const purchase = {
  symbol: 'AAPL',
  side: 'BUY',
  transactionDate: '2026-10-18',
  quantity: '0.00000001',
  unitPrice: '9999999999999999999999.99999999',
  currency: 'USD',
};

describe('when validating a BUY request', () => {
  it('should accept the full exact-decimal input range and an optional description', () => {
    // Arrange
    const input = { ...purchase, description: 'Selected Sunday trade date' };
    // Act
    const result = createBuyTransactionSchema.parse(input);
    // Assert
    expect(result).toStrictEqual(input);
  });

  it.each([
    { quantity: '0' },
    { quantity: '-1' },
    { quantity: 0.1 },
    { quantity: '1e-8' },
    { quantity: '1.000000000' },
    { unitPrice: '0' },
    { unitPrice: '1.123456789' },
    { unitPrice: '10000000000000000000000' },
    { currency: 'EUR' },
    { side: 'SELL' },
    { symbol: 'AAPL/MSFT' },
    { symbol: '' },
    { transactionDate: '2026-02-30' },
    { transactionDate: '0000-01-01' },
    { description: 'a'.repeat(501) },
    { userId: 'another-user' },
    { quoteCurrency: 'USD' },
    { createdAt: '2026-01-01T00:00:00.000Z' },
  ])('should reject unsupported or lossy input: %j', (changes) => {
    // Arrange
    const input = { ...purchase, ...changes };
    // Act
    const result = createBuyTransactionSchema.safeParse(input);
    // Assert
    expect(result.success).toBe(false);
  });
});
