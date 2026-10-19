import { afterEach, describe, expect, it, vi } from 'vitest';

import { purchaseDictionary as text } from '../purchaseDictionary';
import { formatUnitPrice, marketToday, purchaseFormSchema } from './purchaseForm';

afterEach(() => vi.useRealTimers());

describe('when presenting a purchase', () => {
  it.each(['', '0000-01-01', '2026-02-30', 'not-a-date'])(
    'should explain invalid date input %s',
    (transactionDate) => {
      // Act
      const result = purchaseFormSchema.safeParse({
        transactionDate,
        quantity: '1',
        description: '',
      });
      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(text.invalidDate);
    },
  );

  it.each([
    ['230.12345678', 'USD 230.1235'],
    ['0.00005', 'USD 0.0001'],
    ['0.00004999', 'USD 0.0000'],
    ['999.99995', 'USD 1,000.0000'],
    ['9999999999999999999999.99999999', 'USD 10,000,000,000,000,000,000,000.0000'],
    ['12', 'USD 12.0000'],
  ])('should format %s with exact half-up rounding', (value, expected) => {
    // Act
    const formatted = formatUnitPrice(value);
    // Assert
    expect(formatted).toBe(expected);
  });

  it.each([
    ['2026-01-02T04:59:59Z', '2026-01-01'],
    ['2026-01-02T05:00:00Z', '2026-01-02'],
    ['2026-07-02T03:59:59Z', '2026-07-01'],
    ['2026-07-02T04:00:00Z', '2026-07-02'],
  ])('should define today using the New York market date at %s', (instant, expected) => {
    // Act
    const date = marketToday(new Date(instant));
    // Assert
    expect(date).toBe(expected);
  });

  it.each(['', '0', '-1', '1e2', '1.123456789', '10000000000000000000000', '1,5'])(
    'should reject invalid quantity %s',
    (quantity) => {
      // Act
      const result = purchaseFormSchema.safeParse({
        transactionDate: '2026-01-01',
        quantity,
        description: '',
      });
      // Assert
      expect(result.success).toBe(false);
    },
  );

  it('should preserve full precision and validate against the current market date at submission', () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T04:00:00Z'));
    const values = { transactionDate: '2026-01-02', quantity: '0.12345678', description: '' };
    // Act
    const future = purchaseFormSchema.safeParse(values);
    vi.setSystemTime(new Date('2026-01-02T05:00:00Z'));
    const today = purchaseFormSchema.safeParse(values);
    // Assert
    expect(future.success).toBe(false);
    expect(future.error?.issues[0]?.message).toBe(text.futureDate);
    expect(today).toMatchObject({ success: true, data: values });
  });
});
