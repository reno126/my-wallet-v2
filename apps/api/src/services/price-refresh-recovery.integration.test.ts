import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestServer } from '../../test-support/create-test-server.ts';
import { deferred } from '../../test-support/deferred.ts';
import { createMarketCalendar } from '../domain/market-calendar.ts';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createFmpCurrentPriceProvider } from '../providers/fmp/current-price-provider.ts';
import { createPriceCacheRepository } from '../repositories/price-cache.ts';
import { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { createRefreshWorkRepository, type RefreshLease } from '../repositories/refresh-work.ts';
import { createPriceRefreshRecovery } from './price-refresh-recovery.ts';
import { createPriceRefreshScheduler } from './price-refresh-scheduler.ts';

const primary = createTestServer();
const replica = createTestServer();
const calendar = createMarketCalendar('America/New_York');
beforeAll(async () => {
  await Promise.all([primary.ready(), replica.ready()]);
});
afterAll(async () => {
  await Promise.all([primary.close(), replica.close()]);
});

async function createFixture(limit = 250, now: () => Date = () => new Date()) {
  const suffix = randomUUID().replaceAll('-', '').toUpperCase();
  const userId = `recovery-${suffix}`;
  const providerKey = `recovery-${suffix}`;
  const symbols: string[] = [];
  const schedulers: ReturnType<typeof createPriceRefreshScheduler>[] = [];
  const recoveries: ReturnType<typeof createPriceRefreshRecovery>[] = [];
  onTestFinished(async () => {
    await Promise.all([
      ...recoveries.map((recovery) => recovery.stop()),
      ...schedulers.map((scheduler) => scheduler.stop()),
    ]);
    await primary.prisma.user.deleteMany({ where: { id: userId } });
    await primary.prisma.refreshWork.deleteMany({ where: { symbol: { in: symbols } } });
    await primary.prisma.priceSnapshot.deleteMany({ where: { symbol: { in: symbols } } });
    await primary.prisma.providerQuotaDay.deleteMany({ where: { provider: providerKey } });
    await primary.prisma.providerBudget.deleteMany({ where: { provider: providerKey } });
  });
  await primary.prisma.user.create({
    data: { id: userId, name: 'Recovery tests', email: `${suffix}@recovery.test` },
  });
  const wallet = await primary.prisma.wallet.create({ data: { userId, name: 'Recovery wallet' } });
  const quota = createProviderQuotaRepository(primary.prisma, {
    provider: providerKey,
    dailyLimit: limit,
    timeZone: 'America/New_York',
    now,
  });
  const work = createRefreshWorkRepository(primary.prisma, now);
  const cache = createPriceCacheRepository(primary.prisma);
  const dispatched = deferred<void>();
  const fetchRequest = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const symbol = url.searchParams.get('symbol');
    dispatched.resolve();
    return Promise.resolve(
      url.pathname.endsWith('/profile')
        ? Response.json([{ symbol, currency: 'USD' }])
        : Response.json([{ symbol, price: 123.45, timestamp: Math.floor(now().getTime() / 1000) }]),
    );
  });
  const client = createFmpClient({
    environment: {
      FMP_API_KEY: 'test-only-key',
      FMP_BASE_URL: 'https://provider.test.example/stable/',
    },
    reserveRequest: quota.reserveRequest,
    fetch: fetchRequest,
  });
  const provider = createFmpCurrentPriceProvider(client, calendar, now);
  const onError = vi.fn<() => void>();
  function symbol() {
    const value = `R${suffix}${symbols.length}`;
    symbols.push(value);
    return value;
  }
  async function request(value: string) {
    await work.requestForWallet(userId, wallet.id, value);
  }
  function scheduler(database = primary.prisma) {
    const instance = createPriceRefreshScheduler({
      work: createRefreshWorkRepository(database, now),
      cache: createPriceCacheRepository(database),
      provider,
      calendar,
      now,
      onError,
    });
    schedulers.push(instance);
    return instance;
  }
  function recovery(
    instance: ReturnType<typeof createPriceRefreshScheduler>,
    database = primary.prisma,
  ) {
    const repository = createRefreshWorkRepository(database, now);
    const service = createPriceRefreshRecovery({
      work: {
        async *unfinished() {
          for await (const row of repository.unfinished()) {
            if (symbols.includes(row.symbol)) {
              yield row;
            }
          }
        },
      },
      quota,
      scheduler: instance,
      now,
      onError,
    });
    recoveries.push(service);
    return service;
  }
  function snapshot(value: string, retrievedAt = now()) {
    return {
      symbol: value,
      marketDate: calendar.date(retrievedAt),
      retrievedAt,
      unitPrice: '100',
      currency: 'USD',
      source: 'FMP',
    } as const;
  }
  return {
    userId,
    wallet,
    quota,
    work,
    cache,
    provider,
    symbols,
    symbol,
    request,
    scheduler,
    recovery,
    fetchRequest,
    dispatched,
    onError,
    snapshot,
    now,
  };
}

function requireLease(lease: RefreshLease | null) {
  if (!lease) {
    throw new Error('Expected a claimed refresh lease.');
  }
  return lease;
}

describe('when recovering persisted refresh work after a restart', () => {
  it('should enumerate unfinished work across repository pages', async () => {
    // Arrange
    const fixture = await createFixture();
    const symbols = Array.from({ length: 105 }, () => fixture.symbol());
    await primary.prisma.refreshWork.createMany({
      data: symbols.map((symbol) => ({
        symbol,
        requestedAt: fixture.now(),
        updatedAt: fixture.now(),
      })),
    });
    await primary.prisma.refreshSubscription.createMany({
      data: symbols.map((symbol) => ({ symbol, walletId: fixture.wallet.id })),
    });
    const recovered: string[] = [];

    // Act
    for await (const row of fixture.work.unfinished()) {
      if (symbols.includes(row.symbol)) {
        recovered.push(row.symbol);
      }
    }

    // Assert
    expect(recovered.sort()).toEqual(symbols.sort());
    expect(new Set(recovered).size).toBe(105);
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
  });

  it('should reconstruct pending intent and save a quote without a browser request', async () => {
    // Arrange
    const fixture = await createFixture();
    const symbol = fixture.symbol();
    await fixture.request(symbol);
    const scheduler = fixture.scheduler(replica.prisma);
    const recovery = fixture.recovery(scheduler, replica.prisma);

    // Act
    await recovery.start();
    await fixture.dispatched.promise;
    await scheduler.enqueue(symbol);

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect(await fixture.quota.read()).toMatchObject({ used: 2 });
    expect(await fixture.cache.latest(symbol)).toMatchObject({ unitPrice: '123.45' });
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { status: 'SUCCEEDED', attempts: 1 },
    );
  });

  it('should recover ready work before an alphabetically earlier unexpired lease within the remaining allowance', async () => {
    // Arrange
    const instant = new Date('2026-11-02T17:00:00.000Z');
    const fixture = await createFixture(2, () => instant);
    const waiting = fixture.symbol();
    const ready = fixture.symbol();
    await fixture.request(waiting);
    const lease = requireLease(await fixture.work.claim(waiting, 180_000));
    await fixture.request(ready);
    await fixture.quota.reserveRequest();
    const scheduler = fixture.scheduler(replica.prisma);
    const recovery = fixture.recovery(scheduler, replica.prisma);

    // Act
    await recovery.start();
    await fixture.dispatched.promise;
    await scheduler.stop();

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(1);
    expect(
      fixture.fetchRequest.mock.calls.every(
        ([input]) =>
          new URL(input instanceof Request ? input.url : input).searchParams.get('symbol') ===
          ready,
      ),
    ).toBe(true);
    expect(await fixture.quota.read()).toMatchObject({ used: 2, remaining: 0 });
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: waiting } }),
    ).toMatchObject({ status: 'RUNNING', leaseToken: lease.token, attempts: 1 });
  });

  it('should preserve an unexpired lease then allow only one competing recovery after expiry', async () => {
    // Arrange
    let instant = new Date('2026-11-02T17:00:00.000Z');
    const fixture = await createFixture(250, () => new Date(instant));
    const symbol = fixture.symbol();
    await fixture.request(symbol);
    const original = requireLease(await fixture.work.claim(symbol, 180_000));
    const release = deferred<void>();
    fixture.fetchRequest.mockImplementationOnce(async () => {
      await release.promise;
      return Response.json([{ symbol, currency: 'USD' }]);
    });
    const beforeExpiry = [
      fixture.recovery(fixture.scheduler()),
      fixture.recovery(fixture.scheduler(replica.prisma), replica.prisma),
    ];

    // Act
    await Promise.all(beforeExpiry.map((recovery) => recovery.start()));

    // Assert
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { leaseToken: original.token, attempts: 1 },
    );

    // Act
    await Promise.all(beforeExpiry.map((recovery) => recovery.stop()));
    instant = original.expiresAt;
    const first = fixture.scheduler();
    const second = fixture.scheduler(replica.prisma);
    await Promise.all([
      fixture.recovery(first).start(),
      fixture.recovery(second, replica.prisma).start(),
    ]);
    await vi.waitFor(() => expect(fixture.fetchRequest).toHaveBeenCalledTimes(1));
    const staleWrite = await fixture.work.complete(original, fixture.snapshot(symbol));
    release.resolve();
    await Promise.all([first.enqueue(symbol), second.enqueue(symbol)]);

    // Assert
    expect(staleWrite).toBe(false);
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect(await fixture.quota.read()).toMatchObject({ used: 2 });
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { status: 'SUCCEEDED', attempts: 2 },
    );
  });

  it('should continue the persisted retry allowance instead of restarting its attempt count', async () => {
    // Arrange
    const fixture = await createFixture();
    const symbol = fixture.symbol();
    await fixture.request(symbol);
    fixture.fetchRequest.mockReset().mockResolvedValue(new Response(null, { status: 503 }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const lease = requireLease(await fixture.work.claim(symbol, 180_000));
      await fixture.provider.getQuote(symbol);
      await fixture.work.recordFailure(lease, {
        code: 'PROVIDER_ERROR',
        nextAttemptAt: new Date(),
        retry: true,
      });
    }
    const scheduler = fixture.scheduler(replica.prisma);
    const recovery = fixture.recovery(scheduler, replica.prisma);

    // Act
    await recovery.start();
    await vi.waitFor(async () =>
      expect(
        await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } }),
      ).toMatchObject({ status: 'FAILED' }),
    );
    await scheduler.enqueue(symbol);

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(3);
    expect(await fixture.quota.read()).toMatchObject({ used: 3 });
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { status: 'FAILED', attempts: 3, lastFailureCode: 'PROVIDER_ERROR' },
    );
  });

  it('should recover only subscribed unfinished work and retain terminal failures and completed quotes', async () => {
    // Arrange
    const fixture = await createFixture();
    const completed = fixture.symbol();
    const failed = fixture.symbol();
    const orphan = fixture.symbol();
    const pending = fixture.symbol();
    await fixture.request(completed);
    await fixture.work.complete(
      requireLease(await fixture.work.claim(completed, 180_000)),
      fixture.snapshot(completed),
    );
    await fixture.request(failed);
    await fixture.work.recordFailure(requireLease(await fixture.work.claim(failed, 180_000)), {
      code: 'PROVIDER_UNAVAILABLE',
      nextAttemptAt: new Date(0),
      retry: false,
    });
    await primary.prisma.refreshWork.create({
      data: { symbol: orphan, requestedAt: new Date(), updatedAt: new Date() },
    });
    await fixture.request(pending);
    const scheduler = fixture.scheduler();

    // Act
    await fixture.recovery(scheduler).start();
    await fixture.dispatched.promise;
    await scheduler.enqueue(pending);

    // Assert
    expect(
      fixture.fetchRequest.mock.calls.every(
        ([input]) =>
          new URL(input instanceof Request ? input.url : input).searchParams.get('symbol') ===
          pending,
      ),
    ).toBe(true);
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: failed } }),
    ).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: orphan } }),
    ).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(await fixture.cache.latest(completed)).toMatchObject({ unitPrice: '100' });
  });

  it('should retain pending intent and stale prices without consuming quota when recovery has no budget', async () => {
    // Arrange
    const fixture = await createFixture(1);
    const symbol = fixture.symbol();
    await fixture.request(symbol);
    const stale = fixture.snapshot(symbol, new Date(Date.now() - 86_400_000));
    await fixture.cache.save(stale);
    await fixture.quota.reserveRequest();

    // Act
    await fixture.recovery(fixture.scheduler()).start();

    // Assert
    expect(fixture.fetchRequest).not.toHaveBeenCalled();
    expect(await fixture.cache.latest(symbol)).toEqual(stale);
    expect(await fixture.quota.read()).toMatchObject({ used: 1, remaining: 0 });
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { status: 'PENDING', attempts: 0 },
    );
  });

  it('should resume a persisted retry after shutdown cancels its process-local timer', async () => {
    // Arrange
    const fixture = await createFixture();
    const symbol = fixture.symbol();
    await fixture.request(symbol);
    fixture.fetchRequest.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const first = fixture.scheduler();
    const task = first.enqueue(symbol);
    await vi.waitFor(async () =>
      expect(
        await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } }),
      ).toMatchObject({ status: 'PENDING', attempts: 1, lastFailureCode: 'PROVIDER_ERROR' }),
    );

    // Act
    await first.stop();
    await task;
    const second = fixture.scheduler(replica.prisma);
    await fixture.recovery(second, replica.prisma).start();
    await vi.waitFor(
      async () =>
        expect(
          await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } }),
        ).toMatchObject({ status: 'SUCCEEDED' }),
      { timeout: 5000, interval: 10 },
    );

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(3);
    expect(await fixture.quota.read()).toMatchObject({ used: 3 });
    expect(await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol } })).toMatchObject(
      { attempts: 2, nextAttemptAt: null },
    );
  });

  it('should stop admission and drain provider persistence before Fastify disconnects Prisma', async () => {
    // Arrange
    const fixture = await createFixture();
    const active = fixture.symbol();
    const queued = fixture.symbol();
    const release = deferred<void>();
    const started = deferred<void>();
    fixture.fetchRequest.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return Response.json([{ symbol: active, currency: 'USD' }]);
    });
    const server = createTestServer(
      { FMP_API_KEY: 'test-only-key', FMP_REFRESH_CONCURRENCY: '1' },
      { fmp: { reserveRequest: fixture.quota.reserveRequest, fetch: fixture.fetchRequest } },
    );
    onTestFinished(async () => server.close());
    await server.ready();
    const disconnected = vi.spyOn(server.prisma, '$disconnect');
    await server.priceRefresh.requestForWallet(fixture.userId, fixture.wallet.id, active);
    await started.promise;
    await server.priceRefresh.requestForWallet(fixture.userId, fixture.wallet.id, queued);

    // Act
    const closed = server.close();
    await vi.waitFor(async () =>
      expect(
        await server.priceRefresh.requestForWallet(fixture.userId, fixture.wallet.id, queued),
      ).toBe(false),
    );

    // Assert
    expect(disconnected).not.toHaveBeenCalled();

    // Act
    release.resolve();
    await closed;

    // Assert
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(2);
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: active } }),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: queued } }),
    ).toMatchObject({ status: 'PENDING', attempts: 0 });

    // Act
    const next = fixture.scheduler(replica.prisma);
    await fixture.recovery(next, replica.prisma).start();
    await vi.waitFor(async () =>
      expect(
        await primary.prisma.refreshWork.findUniqueOrThrow({ where: { symbol: queued } }),
      ).toMatchObject({ status: 'SUCCEEDED' }),
    );

    // Assert
    expect(fixture.fetchRequest).toHaveBeenCalledTimes(4);
  });
});
