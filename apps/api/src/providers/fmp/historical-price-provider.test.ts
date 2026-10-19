import { describe, expect, it } from 'vitest';

import { createFmpClient } from './client.js';
import { createFmpHistoricalPriceProvider } from './historical-price-provider.js';

describe('when adapting FMP historical prices', () => {
  it('should preserve exact JSON prices and keep consistency metadata out of request parameters', async () => {
    // Arrange
    const requests: URL[] = [];
    const client = createFmpClient({
      environment: { FMP_API_KEY: 'test-only-key', FMP_BASE_URL: 'https://provider.test/stable/' },
      reserveRequest: () => Promise.resolve(true),
      fetch: (input) => {
        requests.push(new URL(input instanceof Request ? input.url : input));
        return Promise.resolve(
          new Response(
            '[{"symbol":"AAPL","date":"2026-10-16","close":9007199254740993.12345678,"currency":"usd"}]',
          ),
        );
      },
    });
    const provider = createFmpHistoricalPriceProvider(client);

    // Act
    const result = await provider.getHistory({
      symbol: 'AAPL',
      from: '2021-10-18',
      to: '2026-10-18',
      expectedCurrency: 'USD',
    });

    // Assert
    expect(result).toStrictEqual({
      ok: true,
      value: [{ date: '2026-10-16', close: '9007199254740993.12345678' }],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe('/stable/historical-price-eod/full');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toStrictEqual({
      symbol: 'AAPL',
      from: '2021-10-18',
      to: '2026-10-18',
      apikey: 'test-only-key',
    });
  });

  it('should reject a currency mismatch even when a later row also has an invalid symbol', async () => {
    // Arrange
    const client = createFmpClient({
      environment: { FMP_API_KEY: 'test-only-key', FMP_BASE_URL: 'https://provider.test/stable/' },
      reserveRequest: () => Promise.resolve(true),
      fetch: () =>
        Promise.resolve(
          Response.json([
            { symbol: 'AAPL', date: '2026-10-16', close: '190', currency: 'EUR' },
            { symbol: 'MSFT', date: '2026-10-15', close: '180' },
          ]),
        ),
    });
    const provider = createFmpHistoricalPriceProvider(client);

    // Act
    const result = await provider.getHistory({
      symbol: 'AAPL',
      from: '2021-10-18',
      to: '2026-10-18',
      expectedCurrency: 'USD',
    });

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'CURRENCY_MISMATCH' } });
  });
});
