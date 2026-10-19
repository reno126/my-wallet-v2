import { describe, expect, it, vi } from 'vitest';

import { createFmpClient } from '../providers/fmp/client.js';
import { createInstrumentSearchService } from './instrument-search.js';

const apple = { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' };
const query = { q: 'AAPL', mode: 'symbol' } as const;

function createHarness(bodies: unknown[], quotaLimit = 1000) {
  const remainingBodies = [...bodies];
  const requests: URL[] = [];
  let used = 0;
  let clockMs = 0;
  const fetchRequest = vi.fn<typeof fetch>((input) => {
    requests.push(new URL(input instanceof Request ? input.url : input));
    if (remainingBodies.length === 0) {
      return Promise.reject(new Error('Unexpected provider request.'));
    }
    const body = remainingBodies.shift();
    return Promise.resolve(body instanceof Response ? body : Response.json(body));
  });
  const client = createFmpClient({
    environment: { FMP_API_KEY: 'test-only-key', FMP_BASE_URL: 'https://provider.test/stable/' },
    reserveRequest: () => {
      if (used >= quotaLimit) return Promise.resolve(false);
      used += 1;
      return Promise.resolve(true);
    },
    fetch: fetchRequest,
  });

  return {
    service: createInstrumentSearchService(client, () => clockMs),
    used: () => used,
    advance: (milliseconds: number) => {
      clockMs += milliseconds;
    },
    requests,
  };
}

describe('when searching instruments with a controlled provider', () => {
  it.each(['symbol', 'name'] as const)(
    'should use one request for a complete %s search',
    async (mode) => {
      // Arrange
      const harness = createHarness([[{ ...apple, privateField: 'not-public' }]]);

      // Act
      const result = await harness.service.search({ q: '  Apple & Co  ', mode });

      // Assert
      expect(result).toStrictEqual({
        ok: true,
        value: {
          results: [
            { symbol: 'AAPL', name: 'Apple Inc.', quoteCurrency: 'USD', exchange: 'NASDAQ' },
          ],
          excluded: [],
        },
      });
      expect(harness.used()).toBe(1);
      expect(harness.requests[0]?.pathname).toBe(`/stable/search-${mode}`);
      expect(harness.requests[0]?.searchParams.get('query')).toBe('Apple & Co');
      expect(harness.requests[0]?.searchParams.get('limit')).toBe('10');
    },
  );

  it.each([
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'AAPL', currency: 'USD' },
    { symbol: 'AAPL', name: '', currency: '' },
  ])('should charge two requests only when required details are missing: %j', async (candidate) => {
    // Arrange
    const harness = createHarness([[candidate], [{ ...apple, companyName: apple.name }]]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ quoteCurrency: 'USD', name: apple.name }] },
    });
    expect(harness.used()).toBe(2);
    expect(harness.requests.map((request) => request.pathname)).toStrictEqual([
      '/stable/search-symbol',
      '/stable/profile',
    ]);
    expect(harness.requests[1]?.searchParams.get('symbol')).toBe('AAPL');
  });

  it('should accept an unknown exchange without a profile request', async () => {
    // Arrange
    const harness = createHarness([[{ symbol: 'AAPL', name: apple.name, currency: 'usd' }]]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ exchange: null, quoteCurrency: 'USD' }] },
    });
    expect(harness.used()).toBe(1);
  });

  it.each([
    { candidate: { ...apple, currency: 'EUR' }, reason: 'NON_USD' },
    { candidate: { ...apple, isEtf: true }, reason: 'UNSUPPORTED_INSTRUMENT' },
    { candidate: { ...apple, isFund: true }, reason: 'UNSUPPORTED_INSTRUMENT' },
    { candidate: { ...apple, exchange: 'CRYPTO' }, reason: 'UNSUPPORTED_INSTRUMENT' },
    { candidate: { ...apple, exchange: 'FOREX' }, reason: 'UNSUPPORTED_INSTRUMENT' },
  ])(
    'should explain $reason without fetching an unnecessary profile',
    async ({ candidate, reason }) => {
      // Arrange
      const harness = createHarness([[candidate]]);

      // Act
      const result = await harness.service.search(query);

      // Assert
      expect(result).toStrictEqual({
        ok: true,
        value: {
          results: [],
          excluded: [{ symbol: candidate.symbol, quoteCurrency: candidate.currency, reason }],
        },
      });
      expect(harness.used()).toBe(1);
    },
  );

  it.each([
    { candidate: { symbol: 'AAPL' }, profile: { ...apple, currency: 'EUR' }, reason: 'NON_USD' },
    {
      candidate: { symbol: 'AAPL' },
      profile: { ...apple, isEtf: true },
      reason: 'UNSUPPORTED_INSTRUMENT',
    },
    {
      candidate: { symbol: 'AAPL', currency: 'USD' },
      profile: { ...apple, currency: 'EUR' },
      reason: 'CURRENCY_MISMATCH',
    },
  ])(
    'should exclude unsafe profile details with $reason',
    async ({ candidate, profile, reason }) => {
      // Arrange
      const harness = createHarness([[candidate], [{ ...profile, companyName: apple.name }]]);

      // Act
      const result = await harness.service.search(query);

      // Assert
      expect(result).toMatchObject({ ok: true, value: { results: [], excluded: [{ reason }] } });
      expect(harness.used()).toBe(2);
    },
  );

  it.each([{ profiles: [] }, { profiles: [{ symbol: 'AAPL', companyName: apple.name }] }])(
    'should never assume a missing currency is USD: %j',
    async ({ profiles }) => {
      // Arrange
      const harness = createHarness([[{ symbol: 'AAPL', name: apple.name }], profiles]);

      // Act
      const result = await harness.service.search(query);

      // Assert
      expect(result).toStrictEqual({
        ok: true,
        value: {
          results: [],
          excluded: [{ symbol: 'AAPL', quoteCurrency: null, reason: 'DETAILS_UNAVAILABLE' }],
        },
      });
      expect(harness.used()).toBe(2);
    },
  );

  it('should reject a profile for a different symbol', async () => {
    // Arrange
    const harness = createHarness([
      [{ symbol: 'AAPL' }],
      [{ ...apple, symbol: 'MSFT', companyName: 'Microsoft' }],
    ]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(harness.used()).toBe(2);
  });

  it('should bound result processing and profile fan-out even when the provider ignores limit', async () => {
    // Arrange
    const candidates = Array.from({ length: 12 }, (_value, index) => ({ symbol: `STOCK${index}` }));
    const profiles = candidates
      .slice(0, 10)
      .map((candidate) => [{ ...candidate, companyName: 'Stock', currency: 'USD' }]);
    const harness = createHarness([candidates, ...profiles]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result.ok && result.value.results).toHaveLength(10);
    expect(harness.used()).toBe(11);
  });

  it('should resolve a duplicated symbol once', async () => {
    // Arrange
    const harness = createHarness([
      [{ symbol: 'AAPL' }, { symbol: 'AAPL' }],
      [{ ...apple, companyName: apple.name }],
    ]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result.ok && result.value.results).toHaveLength(1);
    expect(harness.used()).toBe(2);
  });

  it('should retain the search charge when the follow-up cannot reserve quota', async () => {
    // Arrange
    const harness = createHarness([[{ symbol: 'AAPL' }]], 1);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_QUOTA_EXHAUSTED' } });
    expect(harness.used()).toBe(1);
    expect(harness.requests).toHaveLength(1);
  });

  it('should charge a failed search and an explicit retry separately without caching the error', async () => {
    // Arrange
    const harness = createHarness([new Response('', { status: 503 }), [apple]]);

    // Act
    const failure = await harness.service.search(query);
    const retry = await harness.service.search(query);

    // Assert
    expect(failure).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(retry.ok).toBe(true);
    expect(harness.used()).toBe(2);
  });

  it('should charge a failed profile and repeat both dispatched calls on explicit retry', async () => {
    // Arrange
    const harness = createHarness([
      [{ symbol: 'AAPL' }],
      new Response('', { status: 503 }),
      [{ symbol: 'AAPL' }],
      [{ ...apple, companyName: apple.name }],
    ]);

    // Act
    const failure = await harness.service.search(query);
    const retry = await harness.service.search(query);

    // Assert
    expect(failure).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(retry.ok).toBe(true);
    expect(harness.used()).toBe(4);
  });

  it.each([
    { symbol: '../escape' },
    { symbol: 'AAPL', currency: 123 },
    { symbol: 'AAPL', name: 123 },
  ])('should reject malformed provider data: %j', async (candidate) => {
    // Arrange
    const harness = createHarness([[candidate]]);

    // Act
    const result = await harness.service.search(query);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(harness.used()).toBe(1);
  });

  it('should reject whitespace searches before reserving quota', async () => {
    // Arrange
    const harness = createHarness([]);

    // Act
    const result = await harness.service.search({ q: '   ', mode: 'symbol' });

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(harness.used()).toBe(0);
  });
});

describe('when a search response is cached', () => {
  it('should reuse a result enriched by a profile without repeating either provider call', async () => {
    // Arrange
    const harness = createHarness(
      [[{ symbol: 'AAPL' }], [{ ...apple, companyName: apple.name }]],
      2,
    );

    // Act
    const first = await harness.service.search(query);
    const cached = await harness.service.search(query);

    // Assert
    expect(first.ok).toBe(true);
    expect(cached).toStrictEqual(first);
    expect(harness.used()).toBe(2);
    expect(harness.requests).toHaveLength(2);
  });

  it.each([{ candidates: [apple] }, { candidates: [] }])(
    'should serve repeat results without reserving another request: %j',
    async ({ candidates }) => {
      // Arrange
      const harness = createHarness([candidates], 1);

      // Act
      const first = await harness.service.search(query);
      const cached = await harness.service.search({ ...query, q: ' AAPL ' });

      // Assert
      expect(cached).toStrictEqual(first);
      expect(harness.used()).toBe(1);
      expect(harness.requests).toHaveLength(1);
    },
  );

  it('should expire at the TTL boundary and charge the next dispatch', async () => {
    // Arrange
    const harness = createHarness([[apple], [apple]]);
    await harness.service.search(query);

    // Act
    harness.advance(60_000);
    await harness.service.search(query);

    // Assert
    expect(harness.used()).toBe(2);
  });

  it('should keep symbol and company-name searches separate', async () => {
    // Arrange
    const harness = createHarness([[apple], []]);

    // Act
    await harness.service.search(query);
    const nameResult = await harness.service.search({ ...query, mode: 'name' });

    // Assert
    expect(nameResult).toStrictEqual({ ok: true, value: { results: [], excluded: [] } });
    expect(harness.used()).toBe(2);
  });

  it('should protect cached data from caller mutation', async () => {
    // Arrange
    const harness = createHarness([[apple]]);
    const first = await harness.service.search(query);
    if (!first.ok) throw new Error('Expected a successful search.');

    // Act
    first.value.results.length = 0;
    const cached = await harness.service.search(query);

    // Assert
    expect(cached.ok && cached.value.results).toHaveLength(1);
    expect(harness.used()).toBe(1);
  });

  it('should bound cache growth by evicting the oldest of 100 entries', async () => {
    // Arrange
    const harness = createHarness(Array.from({ length: 102 }, () => []));
    for (let index = 0; index < 101; index += 1) {
      await harness.service.search({ ...query, q: `STOCK${index}` });
    }

    // Act
    await harness.service.search({ ...query, q: 'STOCK0' });

    // Assert
    expect(harness.used()).toBe(102);
  });
});
