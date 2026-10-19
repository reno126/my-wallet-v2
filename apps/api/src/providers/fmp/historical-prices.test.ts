import { describe, expect, it } from 'vitest';

import { fmpHistoricalPricesSchema, parseHistoricalPriceJson } from './historical-prices.js';

describe('when decoding historical provider prices', () => {
  it.each([
    ['9007199254740993.12345678', '9007199254740993.12345678'],
    ['1234567890123456789012.12345678', '1234567890123456789012.12345678'],
    ['1e-8', '0.00000001'],
    ['1.2345e3', '1234.5'],
    ['190.12000000', '190.12'],
    ['"190.12345678"', '190.12345678'],
  ])('should preserve the exact numeric value of %s', (source, expected) => {
    // Arrange
    const json = `[{"symbol":"AAPL","date":"2026-10-16","close":${source}}]`;

    // Act
    const result = fmpHistoricalPricesSchema.parse(parseHistoricalPriceJson(json));

    // Assert
    expect(result[0]?.close).toBe(expected);
  });

  it.each(['0', '-1', 'null', '1e-9', '1e22', '190.123456789', '"NaN"', '"Infinity"', '"garbage"'])(
    'should reject invalid or unsupported price precision %s',
    (source) => {
      // Arrange
      const json = `[{"symbol":"AAPL","date":"2026-10-16","close":${source}}]`;

      // Act
      const result = fmpHistoricalPricesSchema.safeParse(parseHistoricalPriceJson(json));

      // Assert
      expect(result.success).toBe(false);
    },
  );

  it('should leave unrelated numeric fields subject to their normal schema validation', () => {
    // Arrange
    const json = '[{"symbol":"AAPL","date":"2026-10-16","close":190,"currency":123}]';

    // Act
    const result = fmpHistoricalPricesSchema.safeParse(parseHistoricalPriceJson(json));

    // Assert
    expect(result.success).toBe(false);
  });
});
