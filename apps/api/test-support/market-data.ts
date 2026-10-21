import { randomUUID } from 'node:crypto';

import { expect, onTestFinished, vi } from 'vitest';

import { createMarketCalendar } from '../src/domain/market-calendar.ts';
import type { PriceSnapshot } from '../src/domain/price-snapshot.ts';
import { createPriceCacheRepository } from '../src/repositories/price-cache.ts';
import { createProviderQuotaRepository } from '../src/repositories/provider-quota.ts';
import { createBuyLedgerFixture } from './buy-ledger.ts';

export async function createMarketDataFixture(
  options: {
    limit?: number;
    environment?: Record<string, string>;
    authenticate?: boolean;
  } = {},
) {
  let reserveRequest = () => Promise.resolve(false);
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
  const fixture = await createBuyLedgerFixture(
    {},
    {
      authenticate: options.authenticate ?? true,
      environment: options.environment ?? {},
      fmp: { reserveRequest: () => reserveRequest(), fetch: fetchRequest, timeoutMs: 5000 },
    },
  );
  const provider = `read-model-${randomUUID()}`;
  const quota = createProviderQuotaRepository(fixture.server.prisma, {
    provider,
    dailyLimit: options.limit ?? 250,
    timeZone: 'America/New_York',
  });
  reserveRequest = quota.reserveRequest;
  const cache = createPriceCacheRepository(fixture.server.prisma);
  const calendar = createMarketCalendar('America/New_York');
  onTestFinished(async () => {
    await fixture.server.priceRefresh.stop();
    await fixture.server.prisma.refreshSubscription.deleteMany({
      where: { symbol: { in: fixture.registeredSymbols } },
    });
    await fixture.server.prisma.refreshWork.deleteMany({
      where: { symbol: { in: fixture.registeredSymbols } },
    });
    await fixture.server.prisma.priceSnapshot.deleteMany({
      where: { symbol: { in: fixture.registeredSymbols } },
    });
    await fixture.server.prisma.providerQuotaDay.deleteMany({ where: { provider } });
    await fixture.server.prisma.providerBudget.deleteMany({ where: { provider } });
  });
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
