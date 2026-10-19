import { describe, expect, it } from 'vitest';

import { instrumentSearchQuerySchema, instrumentSearchResponseSchema } from './instrument.js';

describe('when validating instrument search contracts', () => {
  it('should default to symbol search and support an explicit company-name mode', () => {
    // Arrange
    // Act
    const defaultQuery = instrumentSearchQuerySchema.parse({ q: 'AAPL' });
    const nameQuery = instrumentSearchQuerySchema.parse({ q: 'Apple', mode: 'name' });

    // Assert
    expect(defaultQuery.mode).toBe('symbol');
    expect(nameQuery.mode).toBe('name');
  });

  it.each([
    {},
    { q: '' },
    { q: '   ' },
    { q: 'a'.repeat(101) },
    { q: ['AAPL', 'MSFT'] },
    { q: 'AAPL', mode: 'auto' },
    { q: 'AAPL', apikey: 'untrusted' },
  ])('should reject an invalid search query: %j', (input) => {
    // Arrange
    // Act
    const result = instrumentSearchQuerySchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it('should reject a non-USD selectable result and accept an explicit exclusion', () => {
    // Arrange
    const instrument = { symbol: 'SAP', name: 'SAP', exchange: 'XETRA', quoteCurrency: 'EUR' };

    // Act
    const selectable = instrumentSearchResponseSchema.safeParse({
      results: [instrument],
      excluded: [],
    });
    const excluded = instrumentSearchResponseSchema.safeParse({
      results: [],
      excluded: [{ symbol: 'SAP', quoteCurrency: 'EUR', reason: 'NON_USD' }],
    });

    // Assert
    expect(selectable.success).toBe(false);
    expect(excluded.success).toBe(true);
  });
});
