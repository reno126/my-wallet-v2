import { describe, expect, it } from 'vitest';

import {
  buyTransactionResultSchema,
  createBuyTransactionSchema,
  createTransactionSchema,
  transactionIdParamsSchema,
  transactionResultSchema,
} from './transaction.js';

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

describe('when validating trade creation and its resulting inventory', () => {
  it('should validate both transaction deletion identifiers', () => {
    // Arrange
    const params = {
      walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
      transactionId: 'e83cb076-e510-4ae7-aeb4-fba948d650e0',
    };
    // Assert
    expect(transactionIdParamsSchema.safeParse(params).success).toBe(true);
    expect(
      transactionIdParamsSchema.safeParse({
        ...params,
        transactionId: params.transactionId.toUpperCase(),
      }).success,
    ).toBe(true);
    expect(transactionIdParamsSchema.safeParse({ ...params, walletId: 'invalid' }).success).toBe(
      false,
    );
    expect(
      transactionIdParamsSchema.safeParse({ ...params, transactionId: 'invalid' }).success,
    ).toBe(false);
  });

  it('should accept SELL with exact decimal inputs', () => {
    // Arrange
    const input = { ...purchase, side: 'SELL' };
    // Act
    const result = createTransactionSchema.parse(input);
    // Assert
    expect(result).toEqual(input);
  });

  it('should support fully closed holdings without weakening BUY result validation', () => {
    // Arrange
    const result = {
      transaction: {
        ...purchase,
        side: 'SELL',
        id: 'e83cb076-e510-4ae7-aeb4-fba948d650e0',
        walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
        createdAt: '2026-10-19T12:00:00.000Z',
      },
      holding: {
        walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
        symbol: 'AAPL',
        quantity: '0',
        quoteCurrency: 'USD',
      },
    };
    // Assert
    expect(transactionResultSchema.safeParse(result).success).toBe(true);
    expect(buyTransactionResultSchema.safeParse(result).success).toBe(false);
    expect(
      transactionResultSchema.safeParse({
        ...result,
        holding: { ...result.holding, quantity: '-0.1' },
      }).success,
    ).toBe(false);
    expect(
      transactionResultSchema.safeParse({
        ...result,
        holding: { ...result.holding, quantity: '19999999999999999999999.99999998' },
      }).success,
    ).toBe(true);
  });
});
