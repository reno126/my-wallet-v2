import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { apiErrorMessages, apiErrorSchema, historicalPriceSchema } from '@my-wallets/contracts';

import { createInstrumentApiFixture } from '../../test-support/instrument-api.js';

const row = { symbol: 'AAPL', date: '2026-10-16', close: '190.12345678' };
const pricePath = '/api/instruments/AAPL/price?date=2026-10-18&currency=USD';

describe('when requesting historical quotes through the authenticated API', () => {
  it('should return exact prices and effective dates while charging only the history request', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture(
      [{ rawJson: '[{"symbol":"AAPL","date":"2026-10-16","close":9007199254740993.12345678}]' }],
      { quotaLimit: 1 },
    );

    // Act
    const first = await fixture.get(pricePath);
    const cached = await fixture.get(pricePath);

    // Assert
    expect(first.statusCode).toBe(200);
    expect(historicalPriceSchema.parse(first.json())).toMatchObject({
      symbol: 'AAPL',
      requestedDate: '2026-10-18',
      effectiveDate: '2026-10-16',
      unitPrice: '9007199254740993.12345678',
      currency: 'USD',
      source: 'FMP',
      usedPreviousTradingDay: true,
    });
    expect(cached.json()).toStrictEqual(first.json());
    expect(fixture.requests.map((request) => request.pathname)).toStrictEqual([
      '/stable/historical-price-eod/full',
    ]);
    expect(fixture.reservationsAtDispatch).toStrictEqual([1]);
    expect(fixture.used()).toBe(1);
    expect(first.payload).not.toContain('test-only-provider-key');
  });

  it('should use an exact-date close when available, regardless of provider row order', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([
      { body: [row, { ...row, date: '2026-10-14' }, { ...row, date: '2026-10-19' }] },
    ]);

    // Act
    const response = await fixture.get('/api/instruments/AAPL/price?date=2026-10-16&currency=USD');

    // Assert
    expect(response.statusCode).toBe(200);
    expect(historicalPriceSchema.parse(response.json())).toMatchObject({
      requestedDate: '2026-10-16',
      effectiveDate: '2026-10-16',
      usedPreviousTradingDay: false,
    });
    expect(fixture.used()).toBe(1);
  });

  it.each([
    '/api/instruments/AAPL/price?currency=USD',
    '/api/instruments/AAPL/price?date=2026-10-18',
    '/api/instruments/AAPL/price?date=2026-10-18&currency=USD&currency=EUR',
    '/api/instruments/AAPL/price?date=2026-02-30&currency=USD',
    '/api/instruments/AAPL/price?date=2999-01-01&currency=USD',
    '/api/instruments/AAPL/price?date=2026-10-18&date=2026-10-16&currency=USD',
    '/api/instruments/AAPL/price?date=2026-10-18&currency=EUR',
    '/api/instruments/AAPL%2FMSFT/price?date=2026-10-18&currency=USD',
  ])('should reject invalid inputs without spending quota: %s', async (path) => {
    // Arrange
    const fixture = await createInstrumentApiFixture([]);

    // Act
    const response = await fixture.get(path);

    // Assert
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_FAILED');
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should require a session before contacting the provider', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([], { authenticate: false });

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(401);
    expect(fixture.used()).toBe(0);
  });

  it('should reject conflicting historical currency rather than relabeling it USD', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([{ body: [{ ...row, currency: 'EUR' }] }]);

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(422);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('CURRENCY_MISMATCH');
    expect(fixture.used()).toBe(1);
  });

  it('should report missing history only after covering the earliest supported date', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([{ body: [] }]);
    // Act
    const response = await fixture.get('/api/instruments/AAPL/price?date=0002-01-01&currency=USD');
    // Assert
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PRICE_NOT_AVAILABLE');
    expect(fixture.used()).toBe(1);
  });

  it('should expose bounded incomplete coverage without a false not-found result', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture(
      Array.from({ length: 5 }, () => ({ body: [] })),
    );

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PRICE_LOOKUP_INCOMPLETE');
    expect(fixture.used()).toBe(5);
  });

  it('should reject exhausted quota without dispatching history', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([], { quotaLimit: 0 });

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_QUOTA_EXHAUSTED');
    expect(fixture.used()).toBe(0);
    expect(fixture.requests).toHaveLength(0);
  });

  it('should use the durable shared budget at normal startup without an injected reservation function', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-01-02T17:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const quotaDay = { provider: 'FMP', quotaDate: new Date('2040-01-02T00:00:00Z') };
    const fixture = await createInstrumentApiFixture([{ body: [row] }], {
      configureQuota: false,
    });
    await fixture.server.prisma.providerQuotaDay.deleteMany({ where: quotaDay });

    // Act
    try {
      const response = await fixture.get(pricePath);
      const cached = await fixture.get(pricePath);
      // Assert
      expect(response.statusCode).toBe(200);
      expect(cached.statusCode).toBe(200);
      expect(cached.payload).toBe(response.payload);
      expect(fixture.requests).toHaveLength(1);
      expect(
        await fixture.server.prisma.providerBudget.findUnique({ where: { provider: 'FMP' } }),
      ).toMatchObject({ dailyLimit: 250, timeZone: 'America/New_York' });
      expect(
        await fixture.server.prisma.providerQuotaDay.findUnique({
          where: { provider_quotaDate: quotaDay },
        }),
      ).toMatchObject({ used: 1 });
    } finally {
      await fixture.server.prisma.providerQuotaDay.deleteMany({ where: quotaDay });
    }
  });

  it('should charge a failed historical response and each dispatched request of an explicit retry', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([
      { status: 503, body: { 'Error Message': 'private-provider-details' } },
      { body: [row] },
    ]);

    // Act
    const failure = await fixture.get(pricePath);
    const retry = await fixture.get(pricePath);

    // Assert
    expect(failure.statusCode).toBe(502);
    expect(failure.payload).not.toContain('private-provider-details');
    expect(retry.statusCode).toBe(200);
    expect(fixture.used()).toBe(2);
  });

  it('should retain the charges when the historical body times out', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([{ stall: 'body' }]);

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(504);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_TIMEOUT');
    expect(fixture.used()).toBe(1);
  });

  it('should identify and sanitize a payment-required history response', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([
      {
        status: 402,
        rawJson: 'Premium Query Parameter: private-provider-details test-only-provider-key',
      },
    ]);
    // Act
    const response = await fixture.get(pricePath);
    // Assert
    expect(response.statusCode).toBe(502);
    expect(apiErrorSchema.parse(response.json()).error).toMatchObject({
      code: 'PROVIDER_PAYMENT_REQUIRED',
      message: apiErrorMessages.PROVIDER_PAYMENT_REQUIRED,
    });
    expect(response.payload).not.toContain('private-provider-details');
    expect(response.payload).not.toContain('test-only-provider-key');
    expect(fixture.used()).toBe(1);
  });

  it.each(['[{"symbol":"AAPL","date":"2026-10-16","close":190.123456789}]', '{broken'])(
    'should reject malformed or excessive-precision history: %s',
    async (rawJson) => {
      // Arrange
      const fixture = await createInstrumentApiFixture([{ rawJson }]);

      // Act
      const response = await fixture.get(pricePath);

      // Assert
      expect(response.statusCode).toBe(502);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('PROVIDER_ERROR');
      expect(fixture.used()).toBe(1);
    },
  );

  it('should apply the authenticated user limit before serving a cached quote', async () => {
    // Arrange
    const fixture = await createInstrumentApiFixture([{ body: [row] }], {
      environment: { API_AUTHENTICATED_RATE_LIMIT_MAX: '1' },
    });
    await fixture.get(pricePath);

    // Act
    const response = await fixture.get(pricePath);

    // Assert
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(fixture.used()).toBe(1);
  });
});
