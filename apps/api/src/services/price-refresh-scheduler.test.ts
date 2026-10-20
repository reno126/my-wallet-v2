import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { deferred } from '../../test-support/deferred.ts';
import { createMarketCalendar } from '../domain/market-calendar.ts';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import type { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { failure, success } from '../result.ts';
import type { CurrentPriceProvider } from './current-price-provider.ts';
import { createPriceRefreshScheduler } from './price-refresh-scheduler.ts';

const instant = new Date('2026-11-02T17:00:00.000Z');
const snapshot: Omit<PriceSnapshot, 'symbol'> = {
  marketDate: '2026-11-02',
  unitPrice: '123.45',
  currency: 'USD',
  source: 'FMP',
  retrievedAt: instant,
};

function createFixture(concurrency?: number, now?: () => Date) {
  const attempts = new Map<string, number>();
  const work = {
    requestForWallet: vi
      .fn<ReturnType<typeof createRefreshWorkRepository>['requestForWallet']>()
      .mockResolvedValue(true),
    claim: vi
      .fn<ReturnType<typeof createRefreshWorkRepository>['claim']>()
      .mockImplementation((symbol) => {
        const attempt = (attempts.get(symbol) ?? 0) + 1;
        attempts.set(symbol, attempt);
        return Promise.resolve({
          symbol,
          token: 'lease-token',
          expiresAt: new Date(Date.now() + 180_000),
          attempt,
        });
      }),
    complete: vi
      .fn<ReturnType<typeof createRefreshWorkRepository>['complete']>()
      .mockResolvedValue(true),
    fail: vi.fn<ReturnType<typeof createRefreshWorkRepository>['fail']>().mockResolvedValue(true),
  };
  const cache = {
    latest: vi.fn<(symbol: string) => Promise<PriceSnapshot | null>>().mockResolvedValue(null),
  };
  const provider = {
    getQuote: vi.fn<CurrentPriceProvider['getQuote']>().mockResolvedValue(success(snapshot)),
  };
  const onError = vi.fn<() => void>();
  const scheduler = createPriceRefreshScheduler({
    work,
    cache,
    provider,
    onError,
    calendar: createMarketCalendar('America/New_York'),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(now === undefined ? {} : { now }),
  });
  return { work, cache, provider, onError, scheduler };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
});
afterEach(() => vi.useRealTimers());

describe('when coordinating current-price refreshes', () => {
  it('should coalesce normalized queued and running symbols into one completion', async () => {
    // Arrange
    const fixture = createFixture(1);
    const gate = deferred<Awaited<ReturnType<CurrentPriceProvider['getQuote']>>>();
    fixture.provider.getQuote.mockReturnValue(gate.promise);

    // Act
    const first = fixture.scheduler.enqueue('aapl');
    const queued = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(0);
    const running = fixture.scheduler.enqueue('AAPL');
    gate.resolve(success(snapshot));
    await Promise.all([first, queued, running]);

    // Assert
    expect(queued).toBe(first);
    expect(running).toBe(first);
    expect(fixture.provider.getQuote).toHaveBeenCalledExactlyOnceWith('AAPL');
    expect(fixture.work.complete).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 1, 5])(
    'should bound active calls at concurrency %s while processing distinct symbols',
    async (concurrency) => {
      // Arrange
      const fixture = createFixture(concurrency);
      const gate = deferred<void>();
      let active = 0;
      let peak = 0;
      fixture.provider.getQuote.mockImplementation(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
        return success(snapshot);
      });

      // Act
      const tasks = Array.from({ length: 9 }, (unused, index) =>
        fixture.scheduler.enqueue(`SYM${index}`),
      );
      await vi.advanceTimersByTimeAsync(0);
      const initiallyActive = active;
      gate.resolve();
      await Promise.all(tasks);

      // Assert
      expect(initiallyActive).toBe(concurrency ?? 3);
      expect(peak).toBe(concurrency ?? 3);
      expect(fixture.provider.getQuote).toHaveBeenCalledTimes(9);
    },
  );

  it('should reuse a fresh cache snapshot without calling the provider', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.cache.latest.mockResolvedValue({ ...snapshot, symbol: 'AAPL' });

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.provider.getQuote).not.toHaveBeenCalled();
    expect(fixture.work.complete).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL' }),
      expect.objectContaining(snapshot),
    );
  });

  it('should wait outside the limiter and share pending retries with new requests', async () => {
    // Arrange
    const fixture = createFixture(1);
    fixture.provider.getQuote.mockResolvedValueOnce(
      failure({ code: 'PROVIDER_TIMEOUT', retryable: true }),
    );

    // Act
    const first = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(0);
    const repeated = fixture.scheduler.enqueue('AAPL');
    await fixture.scheduler.enqueue('MSFT');

    // Assert
    expect(repeated).toBe(first);
    expect(fixture.provider.getQuote.mock.calls.map(([symbol]) => symbol)).toEqual([
      'AAPL',
      'MSFT',
    ]);
    expect(fixture.work.fail).toHaveBeenCalledWith(
      expect.anything(),
      'PROVIDER_TIMEOUT',
      new Date(instant.getTime() + 1000),
      { retry: true },
    );

    // Act
    await vi.advanceTimersByTimeAsync(1000);
    await first;

    // Assert
    expect(fixture.provider.getQuote.mock.calls.map(([symbol]) => symbol)).toEqual([
      'AAPL',
      'MSFT',
      'AAPL',
    ]);
  });

  it('should stop after three transient attempts and persist a cooldown', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.provider.getQuote.mockResolvedValue(
      failure({ code: 'PROVIDER_ERROR', retryable: true }),
    );

    // Act
    const task = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(3000);
    await task;

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(3);
    expect(fixture.work.fail).toHaveBeenLastCalledWith(
      expect.anything(),
      'PROVIDER_ERROR',
      new Date(instant.getTime() + 303_000),
      { retry: false },
    );
    expect(fixture.work.complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should wait until the persisted deadline if a timer wakes before the clock reaches it', async () => {
    // Arrange
    let clockLagMs = 0;
    const fixture = createFixture(1, () => new Date(Date.now() - clockLagMs));
    fixture.provider.getQuote.mockResolvedValueOnce(
      failure({ code: 'PROVIDER_TIMEOUT', retryable: true }),
    );
    const task = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(0);

    // Act
    clockLagMs = 1;
    await vi.advanceTimersByTimeAsync(1000);

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);

    // Act
    clockLagMs = 0;
    await vi.advanceTimersByTimeAsync(1);
    await task;

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PROVIDER_QUOTA_EXHAUSTED', '2026-11-03T05:00:00.000Z'],
    ['PROVIDER_UNAVAILABLE', '2026-11-02T17:05:00.000Z'],
    ['UNSUPPORTED_CURRENCY', '2026-11-02T17:05:00.000Z'],
  ] as const)('should persist %s without an automatic retry', async (code, nextAttempt) => {
    // Arrange
    const fixture = createFixture();
    fixture.provider.getQuote.mockResolvedValue(failure({ code, retryable: false }));

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.work.fail).toHaveBeenCalledWith(expect.anything(), code, new Date(nextAttempt), {
      retry: false,
    });
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should avoid dispatch when no eligible lease can be claimed', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.work.claim.mockResolvedValue(null);

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.provider.getQuote).not.toHaveBeenCalled();
    expect(fixture.work.complete).not.toHaveBeenCalled();
  });

  it('should stop retrying if the lease no longer owns the failure update', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.provider.getQuote.mockResolvedValue(
      failure({ code: 'PROVIDER_TIMEOUT', retryable: true }),
    );
    fixture.work.fail.mockResolvedValue(false);

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should observe background errors and release the deduplication entry', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.cache.latest.mockRejectedValueOnce(new Error('storage failure'));

    // Act
    await expect(fixture.scheduler.enqueue('AAPL')).rejects.toThrow('storage failure');
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.work.fail).toHaveBeenCalledWith(
      expect.anything(),
      'PROVIDER_UNAVAILABLE',
      expect.any(Date),
      { retry: false },
    );
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
  });

  it('should persist owned wallet intent before scheduling and reject foreign wallets', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.work.requestForWallet.mockResolvedValueOnce(false);

    // Act
    const rejected = await fixture.scheduler.requestForWallet('user', 'foreign-wallet', 'AAPL');
    const accepted = await fixture.scheduler.requestForWallet('user', 'owned-wallet', 'MSFT');
    await fixture.scheduler.enqueue('MSFT');

    // Assert
    expect(rejected).toBe(false);
    expect(accepted).toBe(true);
    expect(fixture.provider.getQuote).toHaveBeenCalledExactlyOnceWith('MSFT');
  });

  it('should retain the original error when recording that failure also throws', async () => {
    // Arrange
    const fixture = createFixture();
    const originalError = new Error('cache read failed');
    const recordingError = new Error('failure write failed');
    fixture.cache.latest.mockRejectedValueOnce(originalError);
    fixture.work.fail.mockRejectedValueOnce(recordingError);

    // Act
    const task = fixture.scheduler.enqueue('AAPL');

    // Assert
    await expect(task).rejects.toBeInstanceOf(AggregateError);
    await expect(task).rejects.toMatchObject({
      cause: originalError,
      errors: [originalError, recordingError],
    });
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.provider.getQuote).not.toHaveBeenCalled();

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
  });

  it('should reject and release queued work when persisting a provider failure throws', async () => {
    // Arrange
    const fixture = createFixture();
    const recordingError = new Error('failure write failed');
    fixture.provider.getQuote.mockResolvedValueOnce(
      failure({ code: 'PROVIDER_TIMEOUT', retryable: true }),
    );
    fixture.work.fail.mockRejectedValueOnce(recordingError);

    // Act
    const task = fixture.scheduler.enqueue('AAPL');

    // Assert
    await expect(task).rejects.toBe(recordingError);
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // Act
    await fixture.scheduler.enqueue('AAPL');

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(2);
  });

  it.each([0, 6, 1.5, NaN, Infinity])('should reject concurrency %s', (concurrency) => {
    // Arrange
    // Act
    // Assert
    expect(() => createFixture(concurrency)).toThrow(ZodError);
  });

  it('should drain an active refresh while skipping queued and newly requested work', async () => {
    // Arrange
    const fixture = createFixture(1);
    const provider = deferred<Awaited<ReturnType<CurrentPriceProvider['getQuote']>>>();
    fixture.provider.getQuote.mockReturnValue(provider.promise);
    const active = fixture.scheduler.enqueue('AAPL');
    const queued = fixture.scheduler.enqueue('MSFT');
    await vi.advanceTimersByTimeAsync(0);

    // Act
    const stopping = fixture.scheduler.stop();
    const duplicateStop = fixture.scheduler.stop();
    const accepted = await fixture.scheduler.requestForWallet('user', 'wallet', 'GOOG');
    await fixture.scheduler.enqueue('META');
    provider.resolve(success(snapshot));
    await Promise.all([stopping, active, queued]);

    // Assert
    expect(duplicateStop).toBe(stopping);
    expect(accepted).toBe(false);
    expect(fixture.work.requestForWallet).not.toHaveBeenCalled();
    expect(fixture.work.claim).toHaveBeenCalledTimes(1);
    expect(fixture.provider.getQuote).toHaveBeenCalledExactlyOnceWith('AAPL');
    expect(fixture.work.complete).toHaveBeenCalledTimes(1);
  });

  it('should cancel a retry wait without dispatching again', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.provider.getQuote.mockResolvedValue(
      failure({ code: 'PROVIDER_TIMEOUT', retryable: true }),
    );
    const task = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(0);

    // Act
    await fixture.scheduler.stop();
    await task;

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
    expect(fixture.work.fail).toHaveBeenCalledWith(
      expect.anything(),
      'PROVIDER_TIMEOUT',
      expect.any(Date),
      { retry: true },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should retain a retry after an in-flight failure during shutdown', async () => {
    // Arrange
    const fixture = createFixture();
    const provider = deferred<Awaited<ReturnType<CurrentPriceProvider['getQuote']>>>();
    fixture.provider.getQuote.mockReturnValue(provider.promise);
    const task = fixture.scheduler.enqueue('AAPL');
    await vi.advanceTimersByTimeAsync(0);

    // Act
    const stopping = fixture.scheduler.stop();
    provider.resolve(failure({ code: 'PROVIDER_TIMEOUT', retryable: true }));
    await Promise.all([stopping, task]);

    // Assert
    expect(fixture.provider.getQuote).toHaveBeenCalledTimes(1);
    expect(fixture.work.fail).toHaveBeenCalledWith(
      expect.anything(),
      'PROVIDER_TIMEOUT',
      expect.any(Date),
      { retry: true },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should drain intent persistence without enqueueing it after shutdown begins', async () => {
    // Arrange
    const fixture = createFixture();
    const persisted = deferred<boolean>();
    fixture.work.requestForWallet.mockReturnValue(persisted.promise);
    const request = fixture.scheduler.requestForWallet('user', 'wallet', 'AAPL');
    let drained = false;

    // Act
    const stopping = fixture.scheduler.stop().then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(drained).toBe(false);

    // Act
    persisted.resolve(true);
    const accepted = await request;
    await stopping;

    // Assert
    expect(accepted).toBe(false);
    expect(fixture.provider.getQuote).not.toHaveBeenCalled();
    expect(drained).toBe(true);
  });

  it.each(['3', null, true])('should reject untyped non-number concurrency %s', (concurrency) => {
    // Arrange
    const fixture = createFixture();
    const options = {
      work: fixture.work,
      cache: fixture.cache,
      provider: fixture.provider,
      calendar: createMarketCalendar('America/New_York'),
      onError: fixture.onError,
      concurrency,
    };

    // Act
    // Assert
    expect(() => {
      Reflect.apply(createPriceRefreshScheduler, undefined, [options]);
    }).toThrow(ZodError);
  });
});
