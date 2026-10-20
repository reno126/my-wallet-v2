import { describe, expect, it } from 'vitest';

import { formatShareQuantity, formatUsdAmount, formatUsdUnitPrice } from './format.ts';

describe('when formatting accounting values for presentation', () => {
  it.each([
    ['1.005', '1.01'],
    ['-1.005', '-1.01'],
    ['0.005', '0.01'],
    ['-0.005', '-0.01'],
    ['-0.004', '0.00'],
    ['9007199254740993.005', '9007199254740993.01'],
    ['1', '1.00'],
  ])('should round USD amount %s to %s using half-up rounding', (amount, expected) => {
    // Act
    const result = formatUsdAmount({ amount, currency: 'USD' });

    // Assert
    expect(result).toBe(expected);
  });

  it.each([
    ['1.23445', '1.2345'],
    ['-1.23445', '-1.2345'],
    ['-0.00001', '0.0000'],
    ['2', '2.0000'],
  ])('should round USD unit price %s to %s', (amount, expected) => {
    // Act
    const result = formatUsdUnitPrice({ amount, currency: 'USD' });

    // Assert
    expect(result).toBe(expected);
  });

  it.each([
    ['1.1234565', '1.123457'],
    ['1.23000000', '1.23'],
    ['0.00000049', '0'],
    ['9.9999995', '10'],
  ])(
    'should format share quantity %s with at most six decimal places as %s',
    (quantity, expected) => {
      // Act
      const result = formatShareQuantity(quantity);

      // Assert
      expect(result).toBe(expected);
    },
  );

  it.each(['NaN', 'Infinity', '1e2', '', ' 1', '0x10'])(
    'should reject invalid presentation input %s',
    (amount) => {
      // Assert
      expect(() => formatUsdAmount({ amount, currency: 'USD' })).toThrow(RangeError);
      expect(() => formatShareQuantity(amount)).toThrow(RangeError);
    },
  );

  it('should reject a negative share quantity', () => {
    // Assert
    expect(() => formatShareQuantity('-1')).toThrow(RangeError);
  });
});
