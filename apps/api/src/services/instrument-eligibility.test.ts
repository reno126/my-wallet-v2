import { describe, expect, it } from 'vitest';

import {
  hasUnsupportedStockClassification,
  validateBuyInstrument,
} from './instrument-eligibility.js';

const stock = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  quoteCurrency: 'USD',
  exchange: 'NASDAQ',
  isEtf: false,
  isFund: false,
};

describe('when identifying known unsupported stock classifications', () => {
  it.each([
    { isEtf: true },
    { isFund: true },
    { exchange: 'CRYPTO' },
    { exchange: 'forex' },
    { exchange: 'COMMODITY' },
    { exchange: 'index' },
  ])('should exclude a known unsupported classification: %j', (classification) => {
    // Arrange
    // Act
    const result = hasUnsupportedStockClassification(classification);

    // Assert
    expect(result).toBe(true);
  });

  it.each([
    {},
    { exchange: null },
    { isEtf: null, isFund: null },
    { isEtf: false, isFund: false, exchange: 'NASDAQ' },
  ])(
    'should leave supported or incomplete discovery metadata eligible for further checks: %j',
    (classification) => {
      // Arrange
      // Act
      const result = hasUnsupportedStockClassification(classification);

      // Assert
      expect(result).toBe(false);
    },
  );
});

describe('when validating a stock for purchase', () => {
  it.each(['USD', 'usd'])('should accept complete stock metadata quoted in %s', (quoteCurrency) => {
    // Arrange
    const instrument = { ...stock, quoteCurrency };

    // Act
    const result = validateBuyInstrument(instrument);

    // Assert
    expect(result).toStrictEqual({
      ok: true,
      value: {
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
        quoteCurrency: 'USD',
      },
    });
  });

  it.each([
    [{ quoteCurrency: null }, 'CURRENCY_UNAVAILABLE'],
    [{ quoteCurrency: undefined }, 'CURRENCY_UNAVAILABLE'],
    [{ quoteCurrency: '' }, 'CURRENCY_UNAVAILABLE'],
    [{ quoteCurrency: 'EUR' }, 'UNSUPPORTED_CURRENCY'],
    [{ isEtf: true }, 'UNSUPPORTED_INSTRUMENT'],
    [{ isFund: true }, 'UNSUPPORTED_INSTRUMENT'],
    [{ isEtf: null }, 'UNSUPPORTED_INSTRUMENT'],
    [{ isEtf: undefined }, 'UNSUPPORTED_INSTRUMENT'],
    [{ isFund: null }, 'UNSUPPORTED_INSTRUMENT'],
    [{ isFund: undefined }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: null }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: undefined }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: '' }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: 'CRYPTO' }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: 'forex' }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: 'COMMODITY' }, 'UNSUPPORTED_INSTRUMENT'],
    [{ exchange: 'index' }, 'UNSUPPORTED_INSTRUMENT'],
    [{ name: '' }, 'PROVIDER_ERROR'],
    [{ name: null }, 'PROVIDER_ERROR'],
    [{ name: undefined }, 'PROVIDER_ERROR'],
    [{ quoteCurrency: null, isFund: true }, 'CURRENCY_UNAVAILABLE'],
    [{ quoteCurrency: 'EUR', isFund: true }, 'UNSUPPORTED_CURRENCY'],
    [{ name: null, isFund: true }, 'UNSUPPORTED_INSTRUMENT'],
  ] as const)(
    'should reject invalid metadata with its existing failure code: %j',
    (changes, code) => {
      // Arrange
      const instrument = { ...stock, ...changes };

      // Act
      const result = validateBuyInstrument(instrument);

      // Assert
      expect(result).toStrictEqual({ ok: false, error: { code } });
    },
  );
});
