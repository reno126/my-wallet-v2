import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestServer } from '../../test-support/create-test-server.ts';
import { deferred } from '../../test-support/deferred.ts';
import { createMarketCalendar } from '../domain/market-calendar.ts';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createFmpCurrentPriceProvider } from '../providers/fmp/current-price-provider.ts';
import { createPriceCacheRepository } from '../repositories/price-cache.ts';
import { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { createPriceRefreshScheduler } from './price-refresh-scheduler.ts';

const primary = createTestServer();
const competitor = createTestServer();
const calendar = createMarketCalendar('America/New_York');

beforeAll(async () => {
  await Promise.all([primary.ready(), competitor.ready()]);
});
afterAll(async () => {
  await Promise.all([primary.close(), competitor.close()]);
});

async function createFixture(dailyLimit = 250) {
  const startedAt = Date.now();
  const now = () => new Date(Date.parse('2026-11-02T17:00:00.000Z') + Date.now() - startedAt);
  const suffix = randomUUID();
  const provider = `scheduler-${suffix}`;
  const symbol = `S${suffix.replaceAll('-', '').toUpperCase()}`;
  const userId = `scheduler-${suffix}`;
  onTestFinished(async () => {
    await primary.prisma.user.deleteMany({ where: { id: userId } });
    await primary.prisma.refreshWork.deleteMany({ where: { symbol } });
    await primary.prisma.priceSnapshot.deleteMany({ where: { symbol } });
    await primary.prisma.providerQuotaDay.deleteMany({ where: { provider } });
    await primary.prisma.providerBudget.deleteMany({ where: { provider } });
  });
  await primary.prisma.user.create({
    data: { id: userId, name: 'Scheduler tests', email: `${suffix}@scheduler.test` },
  });
  const firstWallet = await primary.prisma.wallet.create({
    data: { userId, name: 'First wallet' },
  });
  const secondWallet = await primary.prisma.wallet.create({
    data: { userId, name: 'Second wallet' },
  });
  const cache = createPriceCacheRepository(primary.prisma);
  const work = createRefreshWorkRepository(primary.prisma, now);
  const quota = createProviderQuotaRepository(primary.prisma, {
    provider,
    dailyLimit,
    timeZone: 'America/New_York',
    now,
  });
  const yesterday = new Date(now().getTime() - 86_400_000);
  const stale = {
    symbol,
    marketDate: calendar.date(yesterday),
    unitPrice: '100',
    currency: 'USD',
    source: 'FMP',
    retrievedAt: yesterday,
  } as const;
  await cache.save(stale);
  const profileResponse = () => Response.json([{ symbol, currency: 'USD' }]);
  const quoteResponse = () =>
    new Response(
      `[{"symbol":"${symbol}","price":123.45678901,"timestamp":${Math.floor(now().getTime() / 1000)}}]`,
    );
  const fetchRequest = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return Promise.resolve(url.pathname.endsWith('/profile') ? profileResponse() : quoteResponse());
  });
  const onError = vi.fn<() => void>();
  function scheduler(database = primary.prisma) {
    const client = createFmpClient({
      environment: {
        FMP_API_KEY: 'test-only-key',
        FMP_BASE_URL: 'https://provider.test.example/stable/',
      },
      reserveRequest: quota.reserveRequest,
      fetch: fetchRequest,
    });
    return createPriceRefreshScheduler({
      work: createRefreshWorkRepository(database, now),
      cache: createPriceCacheRepository(database),
      provider: createFmpCurrentPriceProvider(client, calendar, now),
      calendar,
      now,
      onError,
    });
  }
  return {
    symbol,
    userId,
    firstWallet,
    secondWallet,
    cache,
    work,
    quota,
    stale,
    fetchRequest,
    profileResponse,
    quoteResponse,
    scheduler,
    onError,
    now,
  };
}

describe('when scheduling refreshes with PostgreSQL coordination', () => {
  it('should share one active dispatch across competing wallet refreshes and reuse the fresh result', async () => {
    // Arrange
    const fixture = await createFixture();
    const started = deferred<void>();
    const release = deferred<void>();
    fixture.fetchRequest.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return fixture.profileResponse();
    });
    const first = fixture.scheduler();
    const second = fixture.scheduler(competitor.prisma);

    // Act
    await first.requestForWallet(fixture.userId, fixture.firstWallet.id, fixture.symbol);
    await started.promise;
    await second.requestForWallet(fixture.userId, fixture.secondWallet.id, fixture.symbol);
    const firstCompletion = first.enqueue(fixture.symbol);
    await second.enqueue(fixture.symbol);
    release.resolve();
    await firstCompletion;
    await second.requestForWallet(fixture.userId, fixture.secondWallet.id, fixture.symbol);
    await second.enqueue(fixture.symbol);

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect(await fixture.quota.read()).toMatchObject({ used: 2 });
    expect(await fixture.cache.latest(fixture.symbol)).toMatchObject({ unitPrice: '123.45678901' });
    expect(
      await primary.prisma.refreshSubscription.count({ where: { symbol: fixture.symbol } }),
    ).toBe(2);
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ status: 'SUCCEEDED', leaseToken: null });
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  it('should charge failed requests and every retry before saving a successful quote', async () => {
    // Arrange
    const fixture = await createFixture();
    fixture.fetchRequest
      .mockReset()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(fixture.profileResponse())
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(fixture.profileResponse())
      .mockResolvedValueOnce(fixture.quoteResponse());
    await fixture.work.requestForWallet(fixture.userId, fixture.firstWallet.id, fixture.symbol);
    const scheduler = fixture.scheduler();

    // Act
    await scheduler.enqueue(fixture.symbol);

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(5);
    expect(await fixture.quota.read()).toMatchObject({ used: 5 });
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ status: 'SUCCEEDED', attempts: 3, lastFailureCode: null });
    expect(await fixture.cache.latest(fixture.symbol)).toMatchObject({ unitPrice: '123.45678901' });
  });

  it('should stop retry dispatches at the quota boundary and retain the stale quote and retry deadline', async () => {
    // Arrange
    const fixture = await createFixture(2);
    fixture.fetchRequest.mockReset().mockResolvedValue(new Response(null, { status: 503 }));
    await fixture.work.requestForWallet(fixture.userId, fixture.firstWallet.id, fixture.symbol);
    const scheduler = fixture.scheduler();

    // Act
    await scheduler.enqueue(fixture.symbol);
    await scheduler.requestForWallet(fixture.userId, fixture.secondWallet.id, fixture.symbol);
    await scheduler.enqueue(fixture.symbol);

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect(await fixture.quota.read()).toMatchObject({ used: 2, remaining: 0 });
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(fixture.stale);
    const work = await primary.prisma.refreshWork.findUniqueOrThrow({
      where: { symbol: fixture.symbol },
    });
    expect(work).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      lastFailureCode: 'PROVIDER_QUOTA_EXHAUSTED',
    });
    expect(work.nextAttemptAt?.getTime()).toBeGreaterThan(fixture.now().getTime());
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  it('should persist quota exhaustion without dispatch or loss of the stale price', async () => {
    // Arrange
    const fixture = await createFixture(1);
    await fixture.quota.reserveRequest();
    await fixture.work.requestForWallet(fixture.userId, fixture.firstWallet.id, fixture.symbol);
    const scheduler = fixture.scheduler();

    // Act
    await scheduler.enqueue(fixture.symbol);

    // Assert
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(fixture.stale);
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({
      status: 'FAILED',
      lastFailureCode: 'PROVIDER_QUOTA_EXHAUSTED',
      nextAttemptAt: calendar.nextReset(fixture.now()),
    });
    expect(await fixture.quota.read()).toMatchObject({ used: 1 });
  });

  it('should enforce wallet ownership before persisting subscriptions or dispatching', async () => {
    // Arrange
    const fixture = await createFixture();
    const scheduler = fixture.scheduler();

    // Act
    const accepted = await scheduler.requestForWallet(
      'foreign-user',
      fixture.firstWallet.id,
      fixture.symbol,
    );

    // Assert
    expect(accepted).toBe(false);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(
      await primary.prisma.refreshSubscription.count({ where: { symbol: fixture.symbol } }),
    ).toBe(0);
  });
});
