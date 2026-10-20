import pLimit from 'p-limit';

import type { createMarketCalendar } from '../domain/market-calendar.ts';
import { isPriceFresh } from '../domain/price-snapshot.ts';
import type { createPriceCacheRepository } from '../repositories/price-cache.ts';
import type { createRefreshWorkRepository, RefreshLease } from '../repositories/refresh-work.ts';
import { normalizedInstrumentSymbolSchema } from '../schemas/instrument-symbol.ts';
import type { CurrentPriceProvider, RefreshFailure } from './current-price-provider.ts';
import { refreshLeaseMs, refreshRetryDecision } from './refresh-retry.ts';

interface SchedulerOptions {
  work: ReturnType<typeof createRefreshWorkRepository>;
  cache: Pick<ReturnType<typeof createPriceCacheRepository>, 'latest'>;
  provider: CurrentPriceProvider;
  calendar: ReturnType<typeof createMarketCalendar>;
  concurrency?: number;
  now?: () => Date;
  onError: () => void;
}

export function createPriceRefreshScheduler(options: SchedulerOptions) {
  const concurrency = options.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new RangeError('Price refresh concurrency must be an integer from 1 to 5.');
  }
  const limit = pLimit(concurrency);
  const now = options.now ?? (() => new Date());
  const scheduled = new Map<string, Promise<void>>();

  return { enqueue, requestForWallet };

  async function requestForWallet(userId: string, walletId: string, symbol: string) {
    const accepted = await options.work.requestForWallet(userId, walletId, symbol);
    if (accepted) {
      void enqueue(symbol);
    }
    return accepted;
  }

  function enqueue(inputSymbol: string): Promise<void> {
    const symbol = normalizedInstrumentSymbolSchema.parse(inputSymbol);
    const existing = scheduled.get(symbol);
    if (existing) {
      return existing;
    }
    const task = run(symbol).finally(() => scheduled.delete(symbol));
    scheduled.set(symbol, task);
    // Background failures are observed even when the requesting page has already returned.
    void task.catch(options.onError);
    return task;
  }

  async function run(symbol: string) {
    for (let attempt = 1; ; attempt++) {
      const retryAt = await limit(() => refresh(symbol, attempt));
      if (!retryAt) {
        return;
      }
      // Waiting retries remain deduplicated, but do not occupy a provider concurrency slot.
      while (now() < retryAt) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(1, retryAt.getTime() - now().getTime())),
        );
      }
    }
  }

  async function refresh(symbol: string, attempt: number): Promise<Date | null> {
    const lease = await options.work.claim(symbol, refreshLeaseMs);
    if (!lease) {
      return null;
    }
    let providerFailure: RefreshFailure;
    try {
      const cached = await options.cache.latest(symbol);
      if (cached && isPriceFresh(cached, now(), options.calendar)) {
        await options.work.complete(lease, cached);
        return null;
      }
      const result = await options.provider.getQuote(symbol);
      if (result.ok) {
        await options.work.complete(lease, result.value);
        return null;
      }
      providerFailure = result.error;
    } catch (error) {
      await recordFailure(lease, { code: 'PROVIDER_UNAVAILABLE', retryable: false }, attempt);
      throw error;
    }
    return recordFailure(lease, providerFailure, attempt);
  }

  async function recordFailure(
    lease: RefreshLease,
    failure: RefreshFailure,
    attempt: number,
  ): Promise<Date | null> {
    const instant = now();
    const decision = refreshRetryDecision(
      failure,
      attempt,
      instant,
      options.calendar.nextReset(instant),
    );
    const recorded = await options.work.fail(lease, failure.code, decision.nextAttemptAt);
    return recorded && decision.retry ? decision.nextAttemptAt : null;
  }
}
