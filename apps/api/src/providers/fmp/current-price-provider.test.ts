import { describe, expect, it, vi } from 'vitest';

import { createMarketCalendar } from '../../domain/market-calendar.ts';
import { createFmpClient } from './client.ts';
import { createFmpCurrentPriceProvider } from './current-price-provider.ts';

const instant = new Date('2026-11-02T17:00:00.000Z');
const timestamp = Math.floor(instant.getTime() / 1000);

function createFixture(
  profile = '[{"symbol":"AAPL","currency":"USD"}]',
  quote = `[{"symbol":"AAPL","price":123.45,"timestamp":${timestamp}}]`,
) {
  const reserveRequest = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const fetchRequest = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(profile))
    .mockResolvedValueOnce(new Response(quote));
  const client = createFmpClient({
    environment: {
      FMP_API_KEY: 'test-only-key',
      FMP_BASE_URL: 'https://provider.test.example/stable/',
    },
    reserveRequest,
    fetch: fetchRequest,
  });
  return {
    reserveRequest,
    fetchRequest,
    provider: createFmpCurrentPriceProvider(
      client,
      createMarketCalendar('America/New_York'),
      () => instant,
    ),
  };
}

describe('when fetching an FMP current quote', () => {
  it('should preserve exact prices and reserve each profile and quote request', async () => {
    // Arrange
    const fixture = createFixture(
      undefined,
      `[{"symbol":"AAPL","price":9007199254740993.12345678,"timestamp":${timestamp}}]`,
    );

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({
      ok: true,
      value: {
        unitPrice: '9007199254740993.12345678',
        marketDate: '2026-11-02',
        retrievedAt: instant,
        currency: 'USD',
        source: 'FMP',
      },
    });
    expect(fixture.reserveRequest).toHaveBeenCalledTimes(2);
    expect(
      fixture.fetchRequest.mock.calls.map(
        ([url]) => new URL(url instanceof Request ? url.url : url).pathname,
      ),
    ).toEqual(['/stable/profile', '/stable/quote']);
  });

  it.each([
    ['[]', 'PRICE_NOT_AVAILABLE'],
    ['[{"symbol":"MSFT","currency":"USD"}]', 'PROVIDER_ERROR'],
    ['[{"symbol":"AAPL"}]', 'CURRENCY_UNAVAILABLE'],
    ['[{"symbol":"AAPL","currency":"EUR"}]', 'UNSUPPORTED_CURRENCY'],
  ])('should reject profile %s before requesting the quote', async (profile, code) => {
    // Arrange
    const fixture = createFixture(profile);

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({ ok: false, error: { code, retryable: false } });
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    '[]',
    `[{"symbol":"MSFT","price":123,"timestamp":${timestamp}}]`,
    `[{"symbol":"AAPL","price":123,"timestamp":${timestamp + 1}}]`,
    `[{"symbol":"AAPL","price":0,"timestamp":${timestamp}}]`,
    `[{"symbol":"AAPL","price":1e-9,"timestamp":${timestamp}}]`,
    '[{"symbol":"AAPL","price":123,"timestamp":-1}]',
  ])('should reject unusable quote %s without retrying', async (quote) => {
    // Arrange
    const fixture = createFixture(undefined, quote);

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [403, false],
    [404, false],
  ])('should classify HTTP %s as retryable=%s', async (status, retryable) => {
    // Arrange
    const fixture = createFixture();
    fixture.fetchRequest.mockReset().mockResolvedValue(new Response(null, { status }));

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({ ok: false, error: { code: 'PROVIDER_ERROR', retryable } });
  });

  it('should classify transport failures as transient', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.fetchRequest.mockReset().mockRejectedValue(new TypeError('network failure'));

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({ ok: false, error: { code: 'PROVIDER_ERROR', retryable: true } });
  });

  it.each(['profile', 'quote'])(
    'should reject a paid-plan restriction on %s without retrying',
    async (endpoint) => {
      // Arrange
      const fixture = createFixture();
      const denied = new Response('Premium Query Parameter: private-provider-details', {
        status: 402,
      });
      fixture.fetchRequest.mockReset();
      if (endpoint === 'quote') {
        fixture.fetchRequest.mockResolvedValueOnce(
          new Response('[{"symbol":"AAPL","currency":"USD"}]'),
        );
      }
      fixture.fetchRequest.mockResolvedValueOnce(denied);
      // Act
      const result = await fixture.provider.getQuote('AAPL');
      // Assert
      expect(result).toStrictEqual({
        ok: false,
        error: { code: 'PROVIDER_PAYMENT_REQUIRED', retryable: false },
      });
      expect(fixture.fetchRequest).toHaveBeenCalledTimes(endpoint === 'profile' ? 1 : 2);
    },
  );

  it('should stop before a quote when the profile consumed the final quota unit', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.reserveRequest.mockReset().mockResolvedValueOnce(true).mockResolvedValue(false);

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({
      ok: false,
      error: { code: 'PROVIDER_QUOTA_EXHAUSTED', retryable: false },
    });
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
    expect(fixture.reserveRequest).toHaveBeenCalledTimes(2);
  });

  it('should reject a quote whose explicit currency disagrees with the USD profile', async () => {
    // Arrange
    const fixture = createFixture(
      undefined,
      `[{"symbol":"AAPL","price":123,"timestamp":${timestamp},"currency":"EUR"}]`,
    );

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toEqual({ ok: false, error: { code: 'CURRENCY_MISMATCH', retryable: false } });
  });

  it('should derive the market date from the quote timestamp in the US market timezone', async () => {
    // Arrange
    const marketTimestamp = Date.parse('2026-11-02T01:00:00.000Z') / 1000;
    const fixture = createFixture(
      undefined,
      `[{"symbol":"AAPL","price":123,"timestamp":${marketTimestamp}}]`,
    );

    // Act
    const result = await fixture.provider.getQuote('AAPL');

    // Assert
    expect(result).toMatchObject({ ok: true, value: { marketDate: '2026-11-01' } });
  });
});
