import type { createMarketCalendar } from '../domain/market-calendar.ts';
import { isPriceFresh } from '../domain/price-snapshot.ts';
import type { createPriceCacheRepository } from '../repositories/price-cache.ts';
import type { createRefreshWorkRepository, RefreshLease } from '../repositories/refresh-work.ts';
import type { CurrentPriceProvider, RefreshFailure } from './current-price-provider.ts';
import { refreshLeaseMs, refreshRetryDecision } from './refresh-retry.ts';

export interface PriceRefreshExecutorOptions {
  work: Pick<
    ReturnType<typeof createRefreshWorkRepository>,
    'claim' | 'complete' | 'recordFailure'
  >;
  cache: Pick<ReturnType<typeof createPriceCacheRepository>, 'latest'>;
  provider: CurrentPriceProvider;
  calendar: ReturnType<typeof createMarketCalendar>;
  now?: () => Date;
}

export function createPriceRefreshExecutor(options: PriceRefreshExecutorOptions) {
  const now = options.now ?? (() => new Date());
  return { execute };

  async function execute(symbol: string): Promise<Date | null> {
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
      try {
        await recordFailure(lease, { code: 'PROVIDER_UNAVAILABLE', retryable: false });
      } catch (recordingError) {
        throw new AggregateError(
          [error, recordingError],
          'Price refresh execution and failure persistence both failed.',
          { cause: error },
        );
      }
      throw error;
    }
    return recordFailure(lease, providerFailure);
  }

  async function recordFailure(lease: RefreshLease, failure: RefreshFailure): Promise<Date | null> {
    const instant = now();
    const decision = refreshRetryDecision(
      failure,
      lease.attempt,
      instant,
      options.calendar.nextReset(instant),
    );
    const recorded = await options.work.recordFailure(lease, {
      code: failure.code,
      nextAttemptAt: decision.nextAttemptAt,
      retry: decision.retry,
    });
    return recorded && decision.retry ? decision.nextAttemptAt : null;
  }
}
