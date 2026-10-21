import { describe, expect, it } from 'vitest';

import {
  currentPriceSchema,
  holdingRefreshStatusSchema,
  priceRefreshRequestSchema,
  providerQuotaStatusSchema,
  walletRefreshStatusSchema,
} from './market-data.js';

const price = {
  unitPrice: '0.00000001',
  currency: 'USD',
  source: 'FMP',
  marketDate: '2026-10-20',
  retrievedAt: '2026-10-20T17:00:00.000Z',
};

describe('when validating public market data contracts', () => {
  it('should preserve exact cached prices with explicit currency and timestamps', () => {
    // Assert
    expect(currentPriceSchema.parse(price)).toEqual(price);
  });

  it.each([
    { unitPrice: 1 },
    { unitPrice: '0' },
    { unitPrice: '1.000000001' },
    { currency: 'EUR' },
    { source: 'OTHER' },
    { marketDate: 'yesterday' },
    { leaseToken: 'private' },
  ])('should reject invalid or internal price data: %j', (change) => {
    // Assert
    expect(currentPriceSchema.safeParse({ ...price, ...change }).success).toBe(false);
  });

  it('should accept an empty refresh request while rejecting client-selected symbols and ownership', () => {
    // Assert
    expect(priceRefreshRequestSchema.parse(undefined)).toBeUndefined();
    expect(priceRefreshRequestSchema.parse(null)).toBeNull();
    expect(priceRefreshRequestSchema.parse({})).toEqual({});
    for (const input of [{ symbols: ['OTHER'] }, { userId: 'other' }, { force: true }]) {
      expect(priceRefreshRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it('should expose only public work states and known safe failure codes', () => {
    // Arrange
    const status = {
      symbol: 'AAPL',
      freshness: 'stale',
      status: 'failed',
      nextAttemptAt: null,
      lastFailureCode: 'PROVIDER_QUOTA_EXHAUSTED',
    };
    // Assert
    expect(holdingRefreshStatusSchema.parse(status)).toEqual(status);
    expect(
      holdingRefreshStatusSchema.safeParse({ ...status, lastFailureCode: 'raw provider body' })
        .success,
    ).toBe(false);
    expect(holdingRefreshStatusSchema.safeParse({ ...status, leaseToken: 'private' }).success).toBe(
      false,
    );
  });

  it('should describe the application request budget with integer counters and a reset instant', () => {
    // Arrange
    const quota = {
      provider: 'FMP',
      configured: true,
      quotaDate: '2026-10-20',
      timeZone: 'America/New_York',
      limit: 250,
      used: 250,
      remaining: 0,
      exhausted: true,
      resetsAt: '2026-10-21T04:00:00.000Z',
    };
    // Assert
    expect(providerQuotaStatusSchema.parse(quota)).toEqual(quota);
    expect(providerQuotaStatusSchema.safeParse({ ...quota, used: 0.5 }).success).toBe(false);
    expect(providerQuotaStatusSchema.safeParse({ ...quota, remaining: -1 }).success).toBe(false);
  });

  it('should describe durable pending work without promising active synchronization', () => {
    // Arrange
    const status = {
      walletId: 'e10c1c99-341d-4e4f-bb56-d5b646f748d9',
      providerConfigured: false,
      freshness: 'missing',
      hasPendingWork: true,
      holdings: [
        {
          symbol: 'AAPL',
          freshness: 'missing',
          status: 'pending',
          nextAttemptAt: null,
          lastFailureCode: null,
        },
      ],
    };
    // Assert
    expect(walletRefreshStatusSchema.parse(status)).toEqual(status);
    expect(walletRefreshStatusSchema.safeParse({ ...status, isSyncing: true }).success).toBe(false);
  });
});
