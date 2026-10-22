import { describe, expect, it } from 'vitest';

import { createFmpClient } from '../providers/fmp/client.js';
import { createFmpHistoricalPriceProvider } from '../providers/fmp/historical-price-provider.js';
import { createHistoricalPriceService } from './historical-price.js';
import type {
  HistoricalPriceProvider,
  HistoricalPriceWindow,
} from './historical-price-provider.js';

const price = { symbol: 'AAPL', date: '2026-10-16', close: '190.12345678' };

function createHarness(bodies: unknown[], quotaLimit = 100) {
  const pendingBodies = [...bodies];
  const requests: URL[] = [];
  let used = 0;
  let clock = new Date('2026-10-19T16:00:00.000Z');
  const client = createFmpClient({
    environment: { FMP_API_KEY: 'test-only-key', FMP_BASE_URL: 'https://provider.test/stable/' },
    reserveRequest: () => {
      if (used >= quotaLimit) {
        return Promise.resolve(false);
      }
      used += 1;
      return Promise.resolve(true);
    },
    fetch: (input) => {
      requests.push(new URL(input instanceof Request ? input.url : input));
      if (pendingBodies.length === 0) {
        return Promise.reject(new Error('Unexpected provider request.'));
      }
      const body = pendingBodies.shift();
      return Promise.resolve(body instanceof Response ? body : Response.json(body));
    },
  });
  return {
    service: createHistoricalPriceService(createFmpHistoricalPriceProvider(client), () => clock),
    requests,
    used: () => used,
    advance: (milliseconds: number) => {
      clock = new Date(clock.getTime() + milliseconds);
    },
  };
}

describe('when looking up historical prices', () => {
  it('should preserve the selected date and expose the effective trading date and exact price', async () => {
    // Arrange
    const harness = createHarness([[price]]);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toStrictEqual({
      ok: true,
      value: {
        symbol: 'AAPL',
        requestedDate: '2026-10-18',
        effectiveDate: '2026-10-16',
        unitPrice: price.close,
        currency: 'USD',
        source: 'FMP',
        retrievedAt: '2026-10-19T16:00:00.000Z',
        usedPreviousTradingDay: true,
      },
    });
    expect(harness.used()).toBe(1);
    expect(harness.requests[0]?.searchParams.get('from')).toBe('2021-10-18');
    expect(harness.requests[0]?.searchParams.get('to')).toBe('2026-10-18');
  });

  it('should find older history after an empty five-year window and charge every request', async () => {
    // Arrange
    const harness = createHarness([[], [{ ...price, date: '2020-07-01' }]]);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toMatchObject({ ok: true, value: { effectiveDate: '2020-07-01' } });
    expect(harness.used()).toBe(2);
    expect(harness.requests[1]?.searchParams.get('to')).toBe('2021-10-17');
  });

  it.each(['EUR', '', 'usd'])(
    'should reject unsupported request currency %s before dispatch',
    async (currency) => {
      // Arrange
      const harness = createHarness([]);
      // Act
      const result = await harness.service.quote('AAPL', '2026-10-18', currency);
      // Assert
      expect(result).toStrictEqual({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(harness.used()).toBe(0);
    },
  );

  it.each([
    { row: { ...price, currency: 'EUR' }, code: 'CURRENCY_MISMATCH' },
    { row: { ...price, symbol: 'MSFT' }, code: 'PROVIDER_ERROR' },
  ])('should reject unsafe historical data with $code', async ({ row, code }) => {
    // Arrange
    const harness = createHarness([[row]]);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code } });
    expect(harness.used()).toBe(1);
  });

  it('should reject conflicting quotes for the same effective date', async () => {
    // Arrange
    const harness = createHarness([[price, { ...price, close: '191' }]]);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
  });

  it('should report missing quotes only after covering the earliest supported date', async () => {
    // Arrange
    const harness = createHarness([[]]);
    // Act
    const result = await harness.service.quote('AAPL', '0002-01-01', 'USD');
    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PRICE_NOT_AVAILABLE' } });
    expect(harness.used()).toBe(1);
    expect(harness.requests[0]?.searchParams.get('from')).toBe('0000-01-01');
  });

  it('should bound history exploration without claiming all earlier prices are absent', async () => {
    // Arrange
    const harness = createHarness([[], [], [], [], []]);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PRICE_LOOKUP_INCOMPLETE' } });
    expect(harness.used()).toBe(5);
  });

  it('should serve a cached quote without another history request or quota reservation', async () => {
    // Arrange
    const harness = createHarness([[price]], 1);

    // Act
    const first = await harness.service.quote('AAPL', '2026-10-18', 'USD');
    const cached = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(first.ok).toBe(true);
    expect(cached).toStrictEqual(first);
    expect(harness.used()).toBe(1);
    expect(harness.requests).toHaveLength(1);
  });

  it('should expire the cache and charge the next history request', async () => {
    // Arrange
    const harness = createHarness([[price], [price]]);
    await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Act
    harness.advance(60_000);
    await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(harness.used()).toBe(2);
  });

  it('should normalize symbol case without spending additional quota on the same quote', async () => {
    // Arrange
    const harness = createHarness([[price]], 1);

    // Act
    const first = await harness.service.quote('aapl', '2026-10-18', 'USD');
    const cached = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(first).toMatchObject({ ok: true, value: { symbol: 'AAPL' } });
    expect(cached).toStrictEqual(first);
    expect(harness.used()).toBe(1);
  });

  it('should keep requested dates separate in the cache', async () => {
    // Arrange
    const harness = createHarness([[price], [price]]);

    // Act
    await harness.service.quote('AAPL', '2026-10-17', 'USD');
    const otherDate = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(otherDate).toMatchObject({ ok: true, value: { requestedDate: '2026-10-18' } });
    expect(harness.used()).toBe(2);
  });

  it('should protect cached monetary values from caller mutation', async () => {
    // Arrange
    const harness = createHarness([[price]]);
    const first = await harness.service.quote('AAPL', '2026-10-18', 'USD');
    if (!first.ok) {
      throw new Error('Expected a successful historical quote.');
    }

    // Act
    first.value.unitPrice = '1';
    const cached = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(cached).toMatchObject({ ok: true, value: { unitPrice: price.close } });
    expect(harness.used()).toBe(1);
  });

  it('should bound retained quote entries and evict the oldest when capacity is exceeded', async () => {
    // Arrange
    const bodies = Array.from({ length: 102 }, () => [{ ...price, date: '2025-12-31' }]);
    const harness = createHarness(bodies, 1000);
    for (let index = 0; index < 101; index += 1) {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      await harness.service.quote('AAPL', date, 'USD');
    }

    // Act
    const result = await harness.service.quote('AAPL', '2026-01-01', 'USD');

    // Assert
    expect(result.ok).toBe(true);
    expect(harness.used()).toBe(102);
  });

  it('should reject exhausted quota without dispatching history', async () => {
    // Arrange
    const harness = createHarness([], 0);

    // Act
    const result = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_QUOTA_EXHAUSTED' } });
    expect(harness.used()).toBe(0);
    expect(harness.requests).toHaveLength(0);
  });

  it('should charge failures and explicit retries without caching the error', async () => {
    // Arrange
    const harness = createHarness([new Response('', { status: 503 }), [price]]);

    // Act
    const failure = await harness.service.quote('AAPL', '2026-10-18', 'USD');
    const retry = await harness.service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(failure).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(retry.ok).toBe(true);
    expect(harness.used()).toBe(2);
  });

  it.each([
    ['../AAPL', '2026-10-18'],
    ['AAPL', '2026-02-30'],
    ['AAPL', '2026-10-20'],
  ])('should reject invalid or future inputs before dispatch: %s %s', async (symbol, date) => {
    // Arrange
    const harness = createHarness([]);

    // Act
    const result = await harness.service.quote(symbol, date, 'USD');

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(harness.used()).toBe(0);
  });
});

describe('when using the historical-price provider interface', () => {
  it('should search older windows with a normalized symbol and requested USD currency', async () => {
    // Arrange
    const windows: HistoricalPriceWindow[] = [];
    const provider: HistoricalPriceProvider = {
      getHistory: (window) => {
        windows.push(window);
        return Promise.resolve({
          ok: true,
          value: windows.length === 1 ? [] : [{ date: '2020-07-01', close: '123.45' }],
        });
      },
    };
    const service = createHistoricalPriceService(provider, () => new Date('2026-10-19T16:00:00Z'));

    // Act
    const result = await service.quote('aapl', '2026-10-18', 'USD');

    // Assert
    expect(result).toMatchObject({
      ok: true,
      value: { symbol: 'AAPL', effectiveDate: '2020-07-01', unitPrice: '123.45' },
    });
    expect(windows).toStrictEqual([
      { symbol: 'AAPL', from: '2021-10-18', to: '2026-10-18', expectedCurrency: 'USD' },
      { symbol: 'AAPL', from: '2016-10-17', to: '2021-10-17', expectedCurrency: 'USD' },
    ]);
  });

  it('should timestamp retrieval and start cache expiration after a slow provider completes', async () => {
    // Arrange
    let clock = new Date('2026-10-19T16:00:00Z');
    let historyRequests = 0;
    const provider: HistoricalPriceProvider = {
      getHistory: () => {
        historyRequests += 1;
        clock = new Date(clock.getTime() + 90_000);
        return Promise.resolve({ ok: true, value: [price] });
      },
    };
    const service = createHistoricalPriceService(provider, () => clock);

    // Act
    const result = await service.quote('AAPL', '2026-10-18', 'USD');
    clock = new Date(clock.getTime() + 59_999);
    const cached = await service.quote('AAPL', '2026-10-18', 'USD');
    clock = new Date(clock.getTime() + 1);
    const refreshed = await service.quote('AAPL', '2026-10-18', 'USD');

    // Assert
    expect(result).toMatchObject({ ok: true, value: { retrievedAt: '2026-10-19T16:01:30.000Z' } });
    expect(cached).toStrictEqual(result);
    expect(refreshed).toMatchObject({
      ok: true,
      value: { retrievedAt: '2026-10-19T16:04:00.000Z' },
    });
    expect(historyRequests).toBe(2);
  });
});
