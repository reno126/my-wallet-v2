import pLimit from 'p-limit';

import type { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { normalizedInstrumentSymbolSchema } from '../schemas/instrument-symbol.ts';
import { refreshConcurrencySchema } from '../schemas/refresh-concurrency.ts';
import {
  createPriceRefreshExecutor,
  type PriceRefreshExecutorOptions,
} from './price-refresh-executor.ts';
import { waitUntilRefreshDeadline } from './refresh-wait.ts';

interface SchedulerOptions extends PriceRefreshExecutorOptions {
  work: Pick<
    ReturnType<typeof createRefreshWorkRepository>,
    'requestForWallet' | 'claim' | 'complete' | 'recordFailure'
  >;
  concurrency?: number;
  onError: () => void;
}

export function createPriceRefreshScheduler(options: SchedulerOptions) {
  const concurrency = refreshConcurrencySchema.parse(options.concurrency);
  const limit = pLimit(concurrency);
  const now = options.now ?? (() => new Date());
  const executor = createPriceRefreshExecutor({ ...options, now });
  const scheduled = new Map<string, Promise<void>>();
  const pendingIntents = new Set<Promise<boolean>>();
  const shutdown = new AbortController();
  let stopping: Promise<void> | undefined;

  return { enqueue, requestForWallet, stop };

  function requestForWallet(userId: string, walletId: string, symbol: string): Promise<boolean> {
    if (shutdown.signal.aborted) {
      return Promise.resolve(false);
    }
    const request = persistRequest(userId, walletId, symbol).finally(() =>
      pendingIntents.delete(request),
    );
    pendingIntents.add(request);
    return request;
  }

  async function persistRequest(userId: string, walletId: string, symbol: string) {
    const accepted = await options.work.requestForWallet(userId, walletId, symbol);
    if (accepted && !shutdown.signal.aborted) {
      void enqueue(symbol);
    }
    return accepted && !shutdown.signal.aborted;
  }

  function enqueue(inputSymbol: string): Promise<void> {
    if (shutdown.signal.aborted) {
      return Promise.resolve();
    }
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
    while (!shutdown.signal.aborted) {
      const retryAt = await limit(() =>
        shutdown.signal.aborted ? null : executor.execute(symbol),
      );
      if (!retryAt) {
        return;
      }
      // Waiting retries remain deduplicated, but do not occupy a provider concurrency slot.
      await waitUntilRefreshDeadline(retryAt, now, shutdown.signal);
    }
  }

  function stop(): Promise<void> {
    shutdown.abort();
    stopping ??= drain();
    return stopping;
  }

  async function drain() {
    await Promise.allSettled([...scheduled.values(), ...pendingIntents]);
  }
}
