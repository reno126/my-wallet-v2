import { describe, expect, it } from 'vitest';

import { apiErrorSchema, instrumentSearchResponseSchema } from '@my-wallets/contracts';

import {
  createInstrumentApiFixture,
  type FakeProviderResponse,
  type InstrumentApiFixtureOptions,
} from '../../test-support/instrument-api.js';
const apple = { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' };
const searchPath = '/api/instruments/search';
async function createSearchFixture(
  replies: FakeProviderResponse[],
  options: InstrumentApiFixtureOptions = {},
) {
  const fixture = await createInstrumentApiFixture(replies, options);
  return {
    ...fixture,
    search(query = 'q=AAPL') {
      return fixture.get(searchPath + (query ? '?' + query : ''));
    },
  };
}

describe('when using authenticated instrument search against a fake HTTP provider', () => {
  it('should charge one dispatch and reuse the cached response at zero additional cost', async () => {
    // Arrange
    const fixture = await createSearchFixture(
      [{ body: [{ ...apple, internalField: 'not-public' }] }],
      { quotaLimit: 1 },
    );

    // Act
    const first = await fixture.search();
    const cached = await fixture.search();

    // Assert
    expect(first.statusCode).toBe(200);
    const result = instrumentSearchResponseSchema.parse(first.json());
    expect(result).toStrictEqual({
      results: [
        { symbol: apple.symbol, name: apple.name, exchange: apple.exchange, quoteCurrency: 'USD' },
      ],
      excluded: [],
    });
    expect(cached.json()).toStrictEqual(first.json());
    expect(fixture.used()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.reservationsAtDispatch).toStrictEqual([1]);
    expect(first.payload).not.toContain('test-only-provider-key');
    expect(first.payload).not.toContain('internalField');
  });

  it('should charge a conditional profile only after receiving an incomplete name-search result', async () => {
    // Arrange
    const fixture = await createSearchFixture([
      { body: [{ symbol: 'AAPL', name: apple.name }] },
      { body: [{ ...apple, companyName: apple.name }] },
    ]);

    // Act
    const response = await fixture.search('q=Apple&mode=name');

    // Assert
    expect(response.statusCode).toBe(200);
    expect(fixture.requests.map((request) => request.pathname)).toStrictEqual([
      '/stable/search-name',
      '/stable/profile',
    ]);
    expect(fixture.requests[1]?.searchParams.get('symbol')).toBe('AAPL');
    expect(fixture.reservationsAtDispatch).toStrictEqual([1, 2]);
    expect(fixture.used()).toBe(2);
  });

  it('should explain unsupported currencies without a profile call', async () => {
    // Arrange
    const fixture = await createSearchFixture([{ body: [{ ...apple, currency: 'EUR' }] }]);

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(200);
    expect(instrumentSearchResponseSchema.parse(response.json())).toStrictEqual({
      results: [],
      excluded: [{ symbol: 'AAPL', quoteCurrency: 'EUR', reason: 'NON_USD' }],
    });
    expect(fixture.used()).toBe(1);
  });

  it.each([
    '',
    'q=',
    'q=%20%20',
    `q=${'a'.repeat(101)}`,
    'q=AAPL&q=MSFT',
    'q=AAPL&mode=auto',
    'q=AAPL&apikey=untrusted',
  ])('should reject invalid query %s before reserving quota', async (query) => {
    // Arrange
    const fixture = await createSearchFixture([]);

    // Act
    const response = await fixture.search(query);

    // Assert
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_FAILED');
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should require authentication before spending provider quota', async () => {
    // Arrange
    const fixture = await createSearchFixture([], { authenticate: false });

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(401);
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should apply the private user rate limit even to cached searches', async () => {
    // Arrange
    const fixture = await createSearchFixture([{ body: [apple] }], {
      environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '1' },
    });
    await fixture.search();

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(fixture.used()).toBe(1);
  });

  it('should fail closed until the shared reservation store is wired', async () => {
    // Arrange
    const fixture = await createSearchFixture([], { configureQuota: false });

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(fixture.requests).toHaveLength(0);
  });

  it('should reject an absent API key without reserving quota', async () => {
    // Arrange
    const fixture = await createSearchFixture([], { environment: { FMP_API_KEY: '' } });

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(fixture.used()).toBe(0);
  });

  it('should reject an exhausted search without dispatching', async () => {
    // Arrange
    const fixture = await createSearchFixture([], { quotaLimit: 0 });

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_QUOTA_EXHAUSTED');
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should keep the search charge when the needed follow-up budget is unavailable', async () => {
    // Arrange
    const fixture = await createSearchFixture([{ body: [{ symbol: 'AAPL' }] }], { quotaLimit: 1 });

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_QUOTA_EXHAUSTED');
    expect(fixture.used()).toBe(1);
    expect(fixture.requests).toHaveLength(1);
  });

  it('should sanitize a provider failure and charge an explicit retry separately', async () => {
    // Arrange
    const fixture = await createSearchFixture([
      { status: 401, body: { 'Error Message': 'private-key-details' } },
      { body: [apple] },
    ]);

    // Act
    const failure = await fixture.search();
    const retry = await fixture.search();

    // Assert
    expect(failure.statusCode).toBe(502);
    expect(apiErrorSchema.parse(failure.json()).error.code).toBe('PROVIDER_ERROR');
    expect(failure.payload).not.toContain('private-key-details');
    expect(retry.statusCode).toBe(200);
    expect(fixture.used()).toBe(2);
  });

  it('should retain both charges when a profile call fails', async () => {
    // Arrange
    const fixture = await createSearchFixture([{ body: [{ symbol: 'AAPL' }] }, { status: 503 }]);

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(502);
    expect(fixture.used()).toBe(2);
  });

  it('should return a sanitized timeout while retaining its charge', async () => {
    // Arrange
    const fixture = await createSearchFixture([{ stall: true }]);

    // Act
    const response = await fixture.search();

    // Assert
    expect(response.statusCode).toBe(504);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_TIMEOUT');
    expect(fixture.used()).toBe(1);
  });
});
