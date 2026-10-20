import { describe, expect, it } from 'vitest';

import { sellFormSchema } from './sellForm';

const values = {
  quantity: '0.00000001',
  unitPrice: '9999999999999999999999.99999999',
  transactionDate: '2026-01-19',
  description: '',
};

describe('when validating sale form input', () => {
  it('should preserve accepted precision and compare available shares exactly', () => {
    // Assert
    expect(sellFormSchema('0.00000001').parse(values)).toEqual(values);
    expect(sellFormSchema('0').safeParse(values).success).toBe(false);
    expect(
      sellFormSchema('9007199254740993.00000001').safeParse({
        ...values,
        quantity: '9007199254740993.00000002',
      }).success,
    ).toBe(false);
  });

  it.each([
    { quantity: '-1' },
    { quantity: '0' },
    { quantity: 'bad' },
    { quantity: '1e-8' },
    { quantity: '1.123456789' },
    { unitPrice: '0' },
    { unitPrice: 'bad' },
    { transactionDate: '2026-02-30' },
    { transactionDate: '2999-01-01' },
  ])('should reject invalid trade details without throwing: %j', (changes) => {
    // Assert
    expect(sellFormSchema('100').safeParse({ ...values, ...changes }).success).toBe(false);
  });
});
