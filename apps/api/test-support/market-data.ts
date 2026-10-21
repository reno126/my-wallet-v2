import { randomUUID } from 'node:crypto';

import { expect, vi } from 'vitest';

import { createMarketCalendar } from '../src/domain/market-calendar.ts';
import type { PriceSnapshot } from '../src/domain/price-snapshot.ts';
import { createPriceCacheRepository } from '../src/repositories/price-cache.ts';
import {
  createProviderQuotaRepository,
  type ProviderRequestBudget,
} from '../src/repositories/provider-quota.ts';
import { createApiFixture } from './api-fixture.ts';
import { createLedgerFixture } from './ledger.ts';

export async function createMarketDataFixture(
  options: {
    limit?: number;
    environment?: Record<string, string>;
    authenticate?: boolean;
  } = {},
) {
  const budget: ProviderRequestBudget = {
    reserveRequest: () => quota.reserveRequest(),
    read: () => quota.read(),
  };
  const fetchRequest = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const symbol = url.searchParams.get('symbol');
    return Promise.resolve(
      Response.json(
        url.pathname.endsWith('/profile')
          ? [{ symbol, currency: 'USD' }]
          : [{ symbol, price: 25, timestamp: Math.floor(Date.now() / 1000) }],
      ),
    );
  });
  const fixture = await createLedgerFixture(
    await createApiFixture({
      authenticate: options.authenticate ?? true,
      environment: { FMP_API_KEY: 'test-only-provider-key', ...options.environment },
      fmp: { budget, fetch: fetchRequest, timeoutMs: 5000 },
    }),
  );
  const provider = `read-model-${randomUUID()}`;
  const quota = createProviderQuotaRepository(fixture.server.prisma, {
    provider,
    dailyLimit: options.limit ?? 250,
    timeZone: 'America/New_York',
  });
  fixture.registeredProviders.push(provider);
  const cache = createPriceCacheRepository(fixture.server.prisma);
  const calendar = createMarketCalendar('America/New_York');
  const base = `/api/wallets/${fixture.wallet.id}`;
  return {
    ...fixture,
    base,
    fetchRequest,
    quota,
    cache,
    async savePrice(changes: Partial<PriceSnapshot> = {}) {
      const retrievedAt = new Date();
      return cache.save({
        symbol: fixture.symbol,
        marketDate: calendar.date(retrievedAt),
        retrievedAt,
        unitPrice: '25',
        currency: 'USD',
        source: 'FMP',
        ...changes,
      });
    },
    async refresh(url = `${base}/price-refresh`, headers = fixture.headers) {
      const response = await fixture.server.inject({ method: 'POST', url, headers });
      fixture.contract.assertResponse('post', url, response);
      expect(response.headers['cache-control']).toBe('no-store');
      return response;
    },
  };
}
