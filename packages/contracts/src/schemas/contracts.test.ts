import { describe, expect, it } from 'vitest';

import { createTransactionSchema, createWalletSchema, walletSummarySchema } from '../index.js';

describe('public contracts', () => {
  it('accepts USD and rejects unsupported wallet reporting currencies', () => {
    const validWallet = createWalletSchema.safeParse({
      name: 'Long-term',
      reportingCurrency: 'USD',
    });
    const unsupportedWallet = createWalletSchema.safeParse({
      name: 'Long-term',
      reportingCurrency: 'EUR',
    });
    const emptyWalletName = createWalletSchema.safeParse({
      name: '  ',
      reportingCurrency: 'USD',
    });

    expect(validWallet.success).toBe(true);
    expect(unsupportedWallet.success).toBe(false);
    expect(emptyWalletName.success).toBe(false);
  });

  it('accepts exact decimal strings up to eight fractional digits', () => {
    const validTransaction = createTransactionSchema.safeParse({
      symbol: 'MSFT',
      side: 'BUY',
      transactionDate: '2026-10-11',
      quantity: '0.00000001',
      unitPrice: '521.12345678',
      currency: 'USD',
    });
    const excessivePrecision = createTransactionSchema.safeParse({
      symbol: 'MSFT',
      side: 'BUY',
      transactionDate: '2026-10-11',
      quantity: '1',
      unitPrice: '521.123456789',
      currency: 'USD',
    });
    const binaryNumber = createTransactionSchema.safeParse({
      symbol: 'MSFT',
      side: 'BUY',
      transactionDate: '2026-10-11',
      quantity: 1,
      unitPrice: '521',
      currency: 'USD',
    });
    const zeroQuantity = createTransactionSchema.safeParse({
      symbol: 'MSFT',
      side: 'BUY',
      transactionDate: '2026-10-11',
      quantity: '0',
      unitPrice: '521',
      currency: 'USD',
    });
    const oversizedAmount = createTransactionSchema.safeParse({
      symbol: 'MSFT',
      side: 'BUY',
      transactionDate: '2026-10-11',
      quantity: '1',
      unitPrice: '12345678901234567890123',
      currency: 'USD',
    });

    expect(validTransaction.success).toBe(true);
    expect(excessivePrecision.success).toBe(false);
    expect(binaryNumber.success).toBe(false);
    expect(zeroQuantity.success).toBe(false);
    expect(oversizedAmount.success).toBe(false);
  });

  it('keeps wallet response fields limited to lifecycle metadata and reporting currency', () => {
    const walletResponse = walletSummarySchema.safeParse({
      id: 'fa8e5e7c-2ef9-4339-8435-0d8b416e8b14',
      name: 'Long-term',
      description: 'Retirement investments',
      createdAt: '2026-10-11T12:00:00.000Z',
      updatedAt: '2026-10-11T12:00:00.000Z',
      reportingCurrency: 'USD',
    });

    expect(walletResponse.success).toBe(true);
  });
});
