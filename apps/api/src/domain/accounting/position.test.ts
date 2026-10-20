import { Decimal } from '@prisma/client/runtime/client';
import { describe, expect, it } from 'vitest';

import { calculatePosition, type LedgerEntry } from './position.ts';

const scope = { walletId: 'wallet', symbol: 'AAPL', currency: 'USD' };

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ...scope,
    id,
    side: 'BUY',
    transactionDate: '2026-01-01',
    createdAt: new Date('2026-01-01T12:00:00Z'),
    quantity: '1',
    unitPrice: '1',
    ...overrides,
  };
}

function position(entries: readonly LedgerEntry[]) {
  const result = calculatePosition(scope, entries);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
}

describe('when calculating a position from its ledger', () => {
  it('should represent an empty position without an average cost', () => {
    // Act
    const result = position([]);

    // Assert
    expect(result).toEqual({
      ...scope,
      quantity: '0',
      remainingCostBasis: '0',
      averageUnitCost: null,
      realizedProfitLoss: '0',
      lots: [],
      sales: [],
    });
  });

  it('should consume the oldest lots and average only the remaining acquisition cost', () => {
    // Arrange
    const entries = [
      entry('a', { quantity: '10', unitPrice: '100' }),
      entry('b', { quantity: '5', unitPrice: '120' }),
      entry('c', { side: 'SELL', quantity: '12', unitPrice: '150' }),
      entry('d', { quantity: '2', unitPrice: '90' }),
      entry('e', { side: 'SELL', unitPrice: '80' }),
    ];

    // Act
    const result = position(entries);

    // Assert
    expect(result).toMatchObject({
      quantity: '4',
      remainingCostBasis: '420',
      averageUnitCost: '105',
      realizedProfitLoss: '520',
      lots: [
        { transactionId: 'b', quantity: '2', unitPrice: '120', costBasis: '240', currency: 'USD' },
        { transactionId: 'd', quantity: '2', unitPrice: '90', costBasis: '180', currency: 'USD' },
      ],
      sales: [
        { transactionId: 'c', proceeds: '1800', costBasis: '1240', realizedProfitLoss: '560' },
        { transactionId: 'e', proceeds: '80', costBasis: '120', realizedProfitLoss: '-40' },
      ],
    });
  });

  it('should preserve every digit when selling across fractional lots', () => {
    // Arrange
    const entries = [
      entry('a', { quantity: '1.23456789', unitPrice: '10.00000001' }),
      entry('b', { quantity: '0.76543211', unitPrice: '20.00000002' }),
      entry('c', { side: 'SELL', quantity: '1.5', unitPrice: '30.00000003' }),
    ];

    // Act
    const result = position(entries);

    // Assert
    expect(result).toMatchObject({
      quantity: '0.5',
      remainingCostBasis: '10.00000001',
      averageUnitCost: '20.00000002',
      realizedProfitLoss: '27.3456789273456789',
      sales: [{ proceeds: '45.000000045', costBasis: '17.6543211176543211' }],
    });
  });

  it('should retain exact products and sums at the maximum supported input size', () => {
    // Arrange
    const maximum = '9999999999999999999999.99999999';
    const firstBuy = entry('a', { quantity: maximum, unitPrice: maximum });
    const entries = [firstBuy, entry('b', { quantity: maximum, unitPrice: maximum })];

    // Act
    const result = position(entries);
    const sold = position([
      firstBuy,
      entry('c', { side: 'SELL', quantity: '0.00000001', unitPrice: '0.00000001' }),
    ]);

    // Assert
    expect(result.quantity).toBe('19999999999999999999999.99999998');
    expect(result.remainingCostBasis).toBe(
      '199999999999999999999999999999600000000000000.0000000000000002',
    );
    expect(result.averageUnitCost).toBe(maximum);
    expect(sold.remainingCostBasis).toBe(
      '99999999999999999999999999999700000000000000.0000000000000002',
    );
    expect(sold.realizedProfitLoss).toBe('-99999999999999.9999999999999998');
  });

  it('should preserve very small products without exponential notation', () => {
    // Act
    const result = position([entry('a', { quantity: '0.00000001', unitPrice: '0.00000001' })]);

    // Assert
    expect(result.remainingCostBasis).toBe('0.0000000000000001');
  });

  it('should keep repeating division separate from FIFO profit calculations', () => {
    // Arrange
    const entries = [entry('a'), entry('b', { quantity: '2', unitPrice: '2' })];

    // Act
    const before = position(entries);
    const after = position([...entries, entry('c', { side: 'SELL', unitPrice: '3' })]);

    // Assert
    expect(before.averageUnitCost).toMatch(/^1\.666666666666666666/);
    expect(before.remainingCostBasis).toBe('5');
    expect(after.realizedProfitLoss).toBe('2');
    expect(after.averageUnitCost).toBe('2');
  });

  it('should retain realized results after closing and reopening a position', () => {
    // Arrange
    const entries = [entry('a'), entry('b', { side: 'SELL', unitPrice: '2' })];

    // Act
    const closed = position(entries);
    const reopened = position([...entries, entry('c', { unitPrice: '3' })]);

    // Assert
    expect(closed).toMatchObject({
      quantity: '0',
      remainingCostBasis: '0',
      averageUnitCost: null,
      realizedProfitLoss: '1',
      lots: [],
    });
    expect(reopened).toMatchObject({
      quantity: '1',
      averageUnitCost: '3',
      realizedProfitLoss: '1',
    });
  });

  it('should replay deterministically by transaction date, creation time, and identifier', () => {
    // Arrange
    const early = entry('z', { transactionDate: '2025-12-31', unitPrice: '10' });
    const first = entry('a', { unitPrice: '20' });
    const second = entry('b', { unitPrice: '30' });
    const later = entry('0', { createdAt: new Date('2026-01-01T13:00:00Z'), unitPrice: '40' });
    const sale = entry('sale', {
      transactionDate: '2026-01-02',
      side: 'SELL',
      quantity: '2.5',
      unitPrice: '50',
    });
    const unsorted = Object.freeze(
      [sale, later, second, early, first].map((value) => Object.freeze(value)),
    );

    // Act
    const result = position(unsorted);
    const replayed = position([first, early, sale, second, later]);

    // Assert
    expect(result).toEqual(replayed);
    expect(result.lots.map((lot) => [lot.transactionId, lot.quantity])).toEqual([
      ['b', '0.5'],
      ['0', '1'],
    ]);
    expect(result.sales[0]).toMatchObject({ costBasis: '45', realizedProfitLoss: '80' });
    expect(unsorted.map((value) => value.id)).toEqual(['sale', '0', 'b', 'z', 'a']);
  });

  it('should reject a historical oversell even when later purchases cover it', () => {
    // Arrange
    const entries = [entry('a', { side: 'SELL' }), entry('b')];

    // Act
    const result = calculatePosition(scope, entries);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INSUFFICIENT_HOLDING',
        transactionId: 'a',
        availableQuantity: '0',
        requestedQuantity: '1',
      },
    });
  });

  it('should reject an oversell of one smallest supported share unit', () => {
    // Act
    const result = calculatePosition(scope, [
      entry('a'),
      entry('b', { side: 'SELL', quantity: '1.00000001' }),
    ]);

    // Assert
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_HOLDING', availableQuantity: '1' },
    });
  });

  it('should recompute remaining lots and realized results after removal and backdated re-entry', () => {
    // Arrange
    const firstBuy = entry('a', { quantity: '2', unitPrice: '10' });
    const secondBuy = entry('b', { quantity: '2', unitPrice: '20', transactionDate: '2026-01-03' });
    const sale = entry('c', {
      side: 'SELL',
      quantity: '3',
      unitPrice: '30',
      transactionDate: '2026-01-04',
    });
    const replacementBuy = entry('d', {
      quantity: '2',
      unitPrice: '5',
      transactionDate: '2026-01-02',
    });

    // Act
    const original = position([firstBuy, secondBuy, sale]);
    const removed = position([firstBuy, secondBuy]);
    const reentered = position([firstBuy, secondBuy, replacementBuy, sale]);

    // Assert
    expect(original).toMatchObject({
      quantity: '1',
      remainingCostBasis: '20',
      realizedProfitLoss: '50',
    });
    expect(removed).toMatchObject({
      quantity: '4',
      remainingCostBasis: '60',
      realizedProfitLoss: '0',
    });
    expect(reentered).toMatchObject({
      quantity: '3',
      remainingCostBasis: '45',
      realizedProfitLoss: '65',
    });
    expect(reentered.lots.map((lot) => lot.transactionId)).toEqual(['d', 'b']);
  });

  it.each(['0', '-1', '1e2', '0.000000001', '10000000000000000000000', 'NaN', 'Infinity'])(
    'should reject unsupported quantity or price %s',
    (value) => {
      // Act
      const quantity = calculatePosition(scope, [entry('a', { quantity: value })]);
      const price = calculatePosition(scope, [entry('a', { unitPrice: value })]);

      // Assert
      expect(quantity).toMatchObject({ ok: false, error: { code: 'INVALID_LEDGER_ENTRY' } });
      expect(price).toMatchObject({ ok: false, error: { code: 'INVALID_LEDGER_ENTRY' } });
    },
  );

  it.each(['2026-02-30', '0000-01-01', '2026-1-1'])(
    'should reject invalid ledger date %s',
    (transactionDate) => {
      // Act
      const result = calculatePosition(scope, [entry('a', { transactionDate })]);

      // Assert
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_LEDGER_ENTRY' } });
    },
  );

  it('should reject duplicate identifiers and invalid creation times', () => {
    // Act
    const duplicate = calculatePosition(scope, [entry('a'), entry('a')]);
    const invalidTime = calculatePosition(scope, [entry('a', { createdAt: new Date('invalid') })]);

    // Assert
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'INVALID_LEDGER_ENTRY' } });
    expect(invalidTime).toMatchObject({ ok: false, error: { code: 'INVALID_LEDGER_ENTRY' } });
  });

  it.each([{ walletId: 'another-wallet' }, { symbol: 'MSFT' }])(
    'should reject entries from another position %j',
    (overrides) => {
      // Act
      const result = calculatePosition(scope, [entry('a', overrides)]);

      // Assert
      expect(result).toMatchObject({ ok: false, error: { code: 'LEDGER_SCOPE_MISMATCH' } });
    },
  );

  it('should reject unsupported currencies in the scope and ledger', () => {
    // Act
    const unsupportedScope = calculatePosition({ ...scope, currency: 'EUR' }, []);
    const unsupportedEntry = calculatePosition(scope, [entry('a', { currency: 'EUR' })]);

    // Assert
    expect(unsupportedScope).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } });
    expect(unsupportedEntry).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } });
  });

  it('should isolate accounting precision from the shared Decimal configuration', () => {
    // Arrange
    const originalPrecision = Decimal.precision;
    const originalRounding = Decimal.rounding;

    try {
      Decimal.set({ precision: 5, rounding: Decimal.ROUND_DOWN });

      // Act
      const result = position([entry('a', { quantity: '12345678.12345678', unitPrice: '2' })]);

      // Assert
      expect(result.remainingCostBasis).toBe('24691356.24691356');
      expect(Decimal.precision).toBe(5);
      expect(Decimal.rounding).toBe(Decimal.ROUND_DOWN);
    } finally {
      Decimal.set({ precision: originalPrecision, rounding: originalRounding });
    }
  });
});
