import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z as zod } from 'zod';

import { createTestServer } from '../../test-support/create-test-server.ts';
import { createMarketCalendar } from '../domain/market-calendar.ts';
import { isPriceFresh, type PriceSnapshot } from '../domain/price-snapshot.ts';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createPriceCacheRepository } from './price-cache.ts';
import { createProviderQuotaRepository } from './provider-quota.ts';
import { createRefreshWorkRepository, type RefreshLease } from './refresh-work.ts';
import { createWalletRepository } from './wallets.ts';

const primary = createTestServer();
const replica = createTestServer();
beforeAll(async () => {
  await Promise.all([primary.ready(), replica.ready()]);
});
afterAll(async () => {
  await Promise.all([primary.close(), replica.close()]);
});

async function createFixture(limit = 250) {
  const suffix = randomUUID();
  const provider = `test-${suffix}`;
  const symbol = `Q${suffix.replaceAll('-', '').toUpperCase()}`;
  const userId = `quota-${suffix}`;
  let instant = new Date('2026-11-01T18:00:00.000Z');
  const now = () => new Date(instant);
  const quotaOptions = { provider, dailyLimit: limit, timeZone: 'America/New_York', now };
  onTestFinished(async () => {
    await primary.prisma.user.deleteMany({ where: { id: userId } });
    await primary.prisma.refreshWork.deleteMany({ where: { symbol } });
    await primary.prisma.priceSnapshot.deleteMany({ where: { symbol } });
    await primary.prisma.providerQuotaDay.deleteMany({ where: { provider } });
    await primary.prisma.providerBudget.deleteMany({ where: { provider } });
  });
  await primary.prisma.user.create({
    data: { id: userId, name: 'Quota tests', email: `${suffix}@quota.test` },
  });
  const wallet = await primary.prisma.wallet.create({ data: { userId, name: 'First wallet' } });
  const snapshot: PriceSnapshot = {
    symbol,
    marketDate: '2026-10-30',
    unitPrice: '9007199254740993.12345678',
    currency: 'USD',
    source: 'FMP',
    retrievedAt: now(),
  };
  return {
    provider,
    symbol,
    userId,
    wallet,
    snapshot,
    quotaOptions,
    now,
    setNow(value: string) {
      instant = new Date(value);
    },
    quota: createProviderQuotaRepository(primary.prisma, quotaOptions),
    otherQuota: createProviderQuotaRepository(replica.prisma, quotaOptions),
    cache: createPriceCacheRepository(primary.prisma),
    otherCache: createPriceCacheRepository(replica.prisma),
    work: createRefreshWorkRepository(primary.prisma, now),
    otherWork: createRefreshWorkRepository(replica.prisma, now),
  };
}

function requireLease(lease: RefreshLease | null): RefreshLease {
  if (!lease) {
    throw new Error('Expected a claimed refresh lease.');
  }
  return lease;
}

describe('when persisting shared market data in PostgreSQL', () => {
  it('should atomically cap concurrent reservations across independent clients and retain them after reconstruction', async () => {
    const fixture = await createFixture(7);
    const reservations = await Promise.all(
      Array.from({ length: 24 }, (unusedSlot, index) =>
        (index % 2 === 0 ? fixture.quota : fixture.otherQuota).reserveRequest(),
      ),
    );
    expect(reservations.filter(Boolean)).toHaveLength(7);
    expect(await fixture.otherQuota.read()).toMatchObject({ used: 7, remaining: 0, limit: 7 });
    const reconstructed = createProviderQuotaRepository(replica.prisma, fixture.quotaOptions);
    expect(await reconstructed.reserveRequest()).toBe(false);
    expect(await reconstructed.read()).toMatchObject({ used: 7, remaining: 0 });
  });

  it('should never exceed 250 at a competing final reservation and open a new day at the configured midnight', async () => {
    const fixture = await createFixture();
    fixture.setNow('2026-11-02T04:59:59.999Z');
    await fixture.quota.read();
    await primary.prisma.providerQuotaDay.create({
      data: {
        provider: fixture.provider,
        quotaDate: new Date('2026-11-01T00:00:00.000Z'),
        used: 249,
      },
    });
    const final = await Promise.all(
      Array.from({ length: 16 }, () => fixture.otherQuota.reserveRequest()),
    );
    expect(final.filter(Boolean)).toHaveLength(1);
    expect(await fixture.quota.read()).toMatchObject({ used: 250, remaining: 0 });
    fixture.setNow('2026-11-02T05:00:00.000Z');
    expect(await fixture.quota.read()).toMatchObject({
      quotaDate: '2026-11-02',
      used: 0,
      remaining: 250,
    });
    expect(await fixture.otherQuota.reserveRequest()).toBe(true);
    const days = await primary.prisma.providerQuotaDay.findMany({
      where: { provider: fixture.provider },
      orderBy: { quotaDate: 'asc' },
    });
    expect(days.map((day) => day.used)).toEqual([250, 1]);
  });

  it('should fail closed for a process with a conflicting timezone or limit', async () => {
    const fixture = await createFixture();
    await fixture.quota.reserveRequest();
    for (const changes of [{ dailyLimit: 251 }, { timeZone: 'America/Los_Angeles' }]) {
      const conflicting = createProviderQuotaRepository(replica.prisma, {
        ...fixture.quotaOptions,
        ...changes,
      });
      await expect(conflicting.reserveRequest()).rejects.toThrow('persisted policy');
    }
    expect(await fixture.quota.read()).toMatchObject({ used: 1, limit: 250 });
    expect(
      await primary.prisma.providerQuotaDay.count({ where: { provider: fixture.provider } }),
    ).toBe(1);
  });

  it('should charge dispatched provider failures and retries and stop before dispatch on exhaustion', async () => {
    const fixture = await createFixture(2);
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ price: '10' }));
    const client = createFmpClient({
      environment: {
        FMP_API_KEY: 'test-only-key',
        FMP_BASE_URL: 'https://controlled.test/stable/',
      },
      reserveRequest: fixture.quota.reserveRequest,
      fetch: fetchRequest,
    });
    const request = {
      endpoint: 'quote' as const,
      parameters: { symbol: fixture.symbol },
      responseSchema: zod.object({ price: zod.string() }),
    };
    expect(await client.request(request)).toEqual({
      ok: false,
      error: { code: 'HTTP_ERROR', status: 503 },
    });
    expect((await client.request(request)).ok).toBe(true);
    expect(await client.request(request)).toEqual({
      ok: false,
      error: { code: 'QUOTA_EXHAUSTED' },
    });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(await fixture.quota.read()).toMatchObject({ used: 2, remaining: 0 });
  });

  it('should preserve precise shared snapshots and select the latest market date across clients', async () => {
    const fixture = await createFixture();
    await fixture.cache.save(fixture.snapshot);
    await fixture.otherCache.save({
      ...fixture.snapshot,
      marketDate: '2026-10-29',
      retrievedAt: new Date('2026-11-01T19:00:00Z'),
    });
    expect(await fixture.otherCache.latest(fixture.symbol)).toEqual(fixture.snapshot);
    expect(
      isPriceFresh(
        await fixture.cache.latest(fixture.symbol),
        fixture.now(),
        createMarketCalendar('America/New_York'),
      ),
    ).toBe(true);
    expect(
      await primary.prisma.providerQuotaDay.count({ where: { provider: fixture.provider } }),
    ).toBe(0);
    expect(await fixture.cache.latest('UNKNOWN')).toBeNull();
  });

  it('should keep one snapshot per symbol/date and prevent a delayed response from overwriting newer data', async () => {
    const fixture = await createFixture();
    const newest = {
      ...fixture.snapshot,
      unitPrice: '21.12345678',
      retrievedAt: new Date('2026-11-01T19:00:00Z'),
    };
    await Promise.all([fixture.cache.save(fixture.snapshot), fixture.otherCache.save(newest)]);
    expect(await fixture.cache.save(fixture.snapshot)).toBe(false);
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(newest);
    expect(await primary.prisma.priceSnapshot.count({ where: { symbol: fixture.symbol } })).toBe(1);
  });

  it('should coalesce durable intent and permit only one active lease and provider dispatch', async () => {
    const fixture = await createFixture();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol),
      ),
    );
    const leases = await Promise.all(
      Array.from({ length: 12 }, (unusedSlot, index) =>
        (index % 2 === 0 ? fixture.work : fixture.otherWork).claim(fixture.symbol, 60_000),
      ),
    );
    const winners = leases.filter((lease) => lease !== null);
    expect(winners).toHaveLength(1);
    const lease = requireLease(winners[0] ?? null);
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ price: fixture.snapshot.unitPrice }));
    const client = createFmpClient({
      environment: {
        FMP_API_KEY: 'test-only-key',
        FMP_BASE_URL: 'https://controlled.test/stable/',
      },
      reserveRequest: fixture.quota.reserveRequest,
      fetch: fetchRequest,
    });
    expect(
      (
        await client.request({
          endpoint: 'quote',
          parameters: { symbol: fixture.symbol },
          responseSchema: zod.object({ price: zod.string() }),
        })
      ).ok,
    ).toBe(true);
    expect(await fixture.work.complete(lease, fixture.snapshot)).toBe(true);
    expect(await fixture.otherCache.latest(fixture.symbol)).toEqual(fixture.snapshot);
    expect(await fixture.quota.read()).toMatchObject({ used: 1 });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(
      await primary.prisma.refreshSubscription.count({ where: { symbol: fixture.symbol } }),
    ).toBe(1);
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ status: 'SUCCEEDED', attempts: 1, leaseToken: null });
  });

  it('should retain a running lease when another wallet requests the same symbol', async () => {
    const fixture = await createFixture();
    await fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    const lease = requireLease(await fixture.work.claim(fixture.symbol, 60_000));
    const secondWallet = await primary.prisma.wallet.create({
      data: { userId: fixture.userId, name: 'Second wallet' },
    });
    await fixture.otherWork.requestForWallet(fixture.userId, secondWallet.id, fixture.symbol);
    expect(await fixture.otherWork.claim(fixture.symbol, 60_000)).toBeNull();
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ status: 'RUNNING', leaseToken: lease.token, attempts: 1 });
  });

  it('should normalize symbol case into the same cache, intent and lease key', async () => {
    const fixture = await createFixture();
    await fixture.work.requestForWallet(
      fixture.userId,
      fixture.wallet.id,
      fixture.symbol.toLowerCase(),
    );
    await fixture.otherWork.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    const lease = requireLease(await fixture.otherWork.claim(fixture.symbol.toLowerCase(), 60_000));
    expect(lease.symbol).toBe(fixture.symbol);
    expect(await fixture.work.claim(fixture.symbol, 60_000)).toBeNull();
    expect(await fixture.work.complete(lease, fixture.snapshot)).toBe(true);
    expect(await fixture.cache.latest(fixture.symbol.toLowerCase())).toEqual(fixture.snapshot);
    expect(await primary.prisma.refreshWork.count({ where: { symbol: fixture.symbol } })).toBe(1);
  });

  it('should fence expired workers from saving or failing after a single competing reclamation', async () => {
    const fixture = await createFixture();
    await fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    const expired = requireLease(await fixture.work.claim(fixture.symbol, 1000));
    fixture.setNow('2026-11-01T18:00:01.000Z');
    const claims = await Promise.all([
      fixture.work.claim(fixture.symbol, 60_000),
      fixture.otherWork.claim(fixture.symbol, 60_000),
    ]);
    const current = requireLease(claims.find((lease) => lease !== null) ?? null);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await fixture.work.complete(expired, fixture.snapshot)).toBe(false);
    expect(await fixture.work.fail(expired, 'PROVIDER_ERROR', fixture.now())).toBe(false);
    expect(await fixture.cache.latest(fixture.symbol)).toBeNull();
    expect(await fixture.otherWork.complete(current, fixture.snapshot)).toBe(true);
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ attempts: 2, status: 'SUCCEEDED' });
  });

  it('should retain stale prices and retry timing after failure without allowing wallet opens to bypass it', async () => {
    const fixture = await createFixture();
    const stale = { ...fixture.snapshot, retrievedAt: new Date('2026-10-31T18:00:00Z') };
    await fixture.cache.save(stale);
    await fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    const lease = requireLease(await fixture.work.claim(fixture.symbol, 60_000));
    const nextAttempt = new Date('2026-11-01T19:00:00Z');
    expect(await fixture.work.fail(lease, 'PROVIDER_QUOTA_EXHAUSTED', nextAttempt)).toBe(true);
    await fixture.otherWork.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    expect(await fixture.otherWork.claim(fixture.symbol, 60_000)).toBeNull();
    expect(await fixture.otherCache.latest(fixture.symbol)).toEqual(stale);
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: nextAttempt,
      lastFailureCode: 'PROVIDER_QUOTA_EXHAUSTED',
    });
    fixture.setNow(nextAttempt.toISOString());
    expect(await fixture.otherWork.claim(fixture.symbol, 60_000)).not.toBeNull();
  });

  it('should roll back completion and keep the lease if the snapshot is invalid', async () => {
    const fixture = await createFixture();
    await fixture.cache.save(fixture.snapshot);
    await fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    const lease = requireLease(await fixture.work.claim(fixture.symbol, 60_000));
    await expect(
      fixture.work.complete(lease, {
        ...fixture.snapshot,
        unitPrice: '0',
        retrievedAt: new Date('2026-11-01T18:00:01Z'),
      }),
    ).rejects.toThrow();
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).toMatchObject({ status: 'RUNNING', leaseToken: lease.token });
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(fixture.snapshot);
  });

  it.each(['0', 'NaN', '-1', '1.000000009', '10000000000000000000000'])(
    'should reject invalid or excess quote precision before persistence: %s',
    async (unitPrice) => {
      const fixture = await createFixture();
      await expect(fixture.cache.save({ ...fixture.snapshot, unitPrice })).rejects.toThrow();
      expect(await fixture.cache.latest(fixture.symbol)).toBeNull();
    },
  );

  it('should enforce positive prices and consistent lease metadata at the database boundary', async () => {
    const fixture = await createFixture();
    await expect(
      primary.prisma.priceSnapshot.create({
        data: {
          ...fixture.snapshot,
          marketDate: new Date('2026-10-30T00:00:00Z'),
          unitPrice: '0',
        },
      }),
    ).rejects.toThrow();
    await expect(
      primary.prisma.refreshWork.create({
        data: {
          symbol: fixture.symbol,
          status: 'RUNNING',
          requestedAt: fixture.now(),
          updatedAt: fixture.now(),
        },
      }),
    ).rejects.toThrow();
  });

  it('should reject foreign or missing wallets without recording refresh work', async () => {
    const fixture = await createFixture();
    expect(
      await fixture.work.requestForWallet('another-user', fixture.wallet.id, fixture.symbol),
    ).toBe(false);
    expect(await fixture.work.requestForWallet(fixture.userId, randomUUID(), fixture.symbol)).toBe(
      false,
    );
    expect(await primary.prisma.refreshWork.count({ where: { symbol: fixture.symbol } })).toBe(0);
  });

  it('should cascade only wallet subscriptions and preserve shared prices, quota and work needed elsewhere', async () => {
    const fixture = await createFixture();
    const secondWallet = await primary.prisma.wallet.create({
      data: { userId: fixture.userId, name: 'Second wallet' },
    });
    await fixture.cache.save(fixture.snapshot);
    await fixture.quota.reserveRequest();
    await fixture.work.requestForWallet(fixture.userId, fixture.wallet.id, fixture.symbol);
    await fixture.work.requestForWallet(fixture.userId, secondWallet.id, fixture.symbol);
    const wallets = createWalletRepository(primary.prisma);
    expect(await wallets.deleteForUser(fixture.userId, fixture.wallet.id)).toBe(true);
    expect(
      await primary.prisma.refreshSubscription.findMany({ where: { symbol: fixture.symbol } }),
    ).toEqual([{ walletId: secondWallet.id, symbol: fixture.symbol }]);
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(fixture.snapshot);
    expect(await fixture.quota.read()).toMatchObject({ used: 1 });
    expect(await fixture.otherWork.claim(fixture.symbol, 60_000)).not.toBeNull();
    expect(await wallets.deleteForUser(fixture.userId, secondWallet.id)).toBe(true);
    fixture.setNow('2026-11-01T18:01:00.000Z');
    expect(await fixture.work.claim(fixture.symbol, 60_000)).toBeNull();
    expect(
      await primary.prisma.refreshWork.findUnique({ where: { symbol: fixture.symbol } }),
    ).not.toBeNull();
    expect(await fixture.cache.latest(fixture.symbol)).toEqual(fixture.snapshot);
    expect(await fixture.quota.read()).toMatchObject({ used: 1 });
  });
});
