import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../../test-support/deferred.ts';
import type { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import type { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { createPriceRefreshRecovery } from './price-refresh-recovery.ts';

const instant = new Date('2026-11-02T17:00:00.000Z');
const recoveries: ReturnType<typeof createPriceRefreshRecovery>[] = [];

function createFixture(rows = [{ symbol: 'AAPL', notBefore: instant }], remaining = 250) {
  const work = {
    unfinished: vi
      .fn<ReturnType<typeof createRefreshWorkRepository>['unfinished']>()
      .mockImplementation(async function* () {
        yield* await Promise.resolve(rows);
      }),
  };
  const snapshot = {
    provider: 'FMP',
    quotaDate: '2026-11-02',
    timeZone: 'America/New_York',
    limit: 250,
    used: 250 - remaining,
    remaining,
    resetsAt: new Date('2026-11-03T05:00:00.000Z'),
  };
  const quota = {
    read: vi
      .fn<ReturnType<typeof createProviderQuotaRepository>['read']>()
      .mockResolvedValue(snapshot),
  };
  const scheduler = { enqueue: vi.fn<(symbol: string) => Promise<void>>().mockResolvedValue() };
  const onError = vi.fn<() => void>();
  const recovery = createPriceRefreshRecovery({ work, quota, scheduler, onError });
  recoveries.push(recovery);
  return { recovery, work, quota, scheduler, onError, snapshot };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(instant);
});
afterEach(async () => {
  await Promise.all(recoveries.splice(0).map((recovery) => recovery.stop()));
  vi.useRealTimers();
});

describe('when reconstructing unfinished refresh work', () => {
  it('should avoid starting database work after shutdown', async () => {
    // Arrange
    const fixture = createFixture();
    await fixture.recovery.stop();

    // Act
    await fixture.recovery.start();

    // Assert
    expect(fixture.quota.read).not.toHaveBeenCalled();
    expect(fixture.work.unfinished).not.toHaveBeenCalled();
  });

  it('should drain a startup read and avoid enqueueing if shutdown starts while it is pending', async () => {
    // Arrange
    const fixture = createFixture();
    const read = deferred<Awaited<ReturnType<typeof fixture.quota.read>>>();
    fixture.quota.read.mockReturnValue(read.promise);
    const started = fixture.recovery.start();
    let drained = false;

    // Act
    const stopping = fixture.recovery.stop().then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(drained).toBe(false);

    // Act
    read.resolve(fixture.snapshot);
    await Promise.all([started, stopping]);

    // Assert
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
    expect(fixture.work.unfinished).not.toHaveBeenCalled();
    expect(drained).toBe(true);
  });

  it('should start once and finish reconstruction without waiting for provider completion', async () => {
    // Arrange
    const fixture = createFixture();
    const provider = deferred<void>();
    fixture.scheduler.enqueue.mockReturnValue(provider.promise);

    // Act
    const first = fixture.recovery.start();
    const second = fixture.recovery.start();
    await first;

    // Assert
    expect(second).toBe(first);
    expect(fixture.work.unfinished).toHaveBeenCalledTimes(1);
    expect(fixture.scheduler.enqueue).toHaveBeenCalledExactlyOnceWith('AAPL');

    // Act
    provider.resolve();
    await fixture.recovery.stop();
  });

  it('should preserve an unexpired lease deadline before requeueing its symbol', async () => {
    // Arrange
    const fixture = createFixture([
      { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 1000) },
    ]);

    // Act
    await fixture.recovery.start();
    await vi.advanceTimersByTimeAsync(999);

    // Assert
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();

    // Act
    await vi.advanceTimersByTimeAsync(1);

    // Assert
    expect(fixture.scheduler.enqueue).toHaveBeenCalledExactlyOnceWith('AAPL');
  });

  it('should leave work persisted without requeueing when the daily budget is empty', async () => {
    // Arrange
    const fixture = createFixture(undefined, 0);

    // Act
    await fixture.recovery.start();

    // Assert
    expect(fixture.work.unfinished).not.toHaveBeenCalled();
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
  });

  it('should bound reconstructed work by the remaining allowance', async () => {
    // Arrange
    const fixture = createFixture(
      ['AAPL', 'MSFT', 'GOOG'].map((symbol) => ({ symbol, notBefore: instant })),
      2,
    );

    // Act
    await fixture.recovery.start();

    // Assert
    expect(fixture.scheduler.enqueue.mock.calls).toEqual([['AAPL'], ['MSFT']]);
  });

  it('should prioritize ready work over earlier waiting candidates when allowance is limited', async () => {
    // Arrange
    const fixture = createFixture(
      [
        { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 180_000) },
        { symbol: 'MSFT', notBefore: instant },
      ],
      1,
    );

    // Act
    await fixture.recovery.start();
    await vi.advanceTimersByTimeAsync(180_000);

    // Assert
    expect(fixture.scheduler.enqueue).toHaveBeenCalledExactlyOnceWith('MSFT');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should use only the remaining admission allowance for waiting work after ready work', async () => {
    // Arrange
    const fixture = createFixture(
      [
        { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 1000) },
        { symbol: 'MSFT', notBefore: instant },
        { symbol: 'GOOG', notBefore: new Date(instant.getTime() + 1000) },
      ],
      2,
    );

    // Act
    await fixture.recovery.start();

    // Assert
    expect(fixture.scheduler.enqueue).toHaveBeenCalledExactlyOnceWith('MSFT');

    // Act
    await vi.advanceTimersByTimeAsync(1000);

    // Assert
    expect(fixture.scheduler.enqueue.mock.calls).toEqual([['MSFT'], ['AAPL']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should recheck quota after waiting rather than dispatching with an exhausted budget', async () => {
    // Arrange
    const fixture = createFixture([
      { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 1000) },
    ]);
    fixture.quota.read
      .mockResolvedValueOnce(fixture.snapshot)
      .mockResolvedValue({ ...fixture.snapshot, remaining: 0, used: 250 });

    // Act
    await fixture.recovery.start();
    await vi.advanceTimersByTimeAsync(1000);

    // Assert
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
    expect(fixture.quota.read).toHaveBeenCalledTimes(2);
  });

  it('should cancel future recovery timers on shutdown', async () => {
    // Arrange
    const fixture = createFixture([
      { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 180_000) },
    ]);
    await fixture.recovery.start();

    // Act
    await fixture.recovery.stop();

    // Assert
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should observe startup read failures without losing shutdown cleanup', async () => {
    // Arrange
    const fixture = createFixture();
    fixture.quota.read.mockRejectedValue(new Error('storage unavailable'));

    // Act
    await fixture.recovery.start();
    await fixture.recovery.stop();

    // Assert
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
  });

  it('should observe failures from a delayed recovery attempt', async () => {
    // Arrange
    const fixture = createFixture([
      { symbol: 'AAPL', notBefore: new Date(instant.getTime() + 1000) },
    ]);
    fixture.quota.read
      .mockResolvedValueOnce(fixture.snapshot)
      .mockRejectedValue(new Error('quota unavailable'));

    // Act
    await fixture.recovery.start();
    await vi.advanceTimersByTimeAsync(1000);

    // Assert
    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.scheduler.enqueue).not.toHaveBeenCalled();
  });
});
