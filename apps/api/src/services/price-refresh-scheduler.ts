import pLimit from 'p-limit';

import type { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { normalizedInstrumentSymbolSchema } from '../schemas/instrument-symbol.ts';
import { refreshConcurrencySchema } from '../schemas/refresh-concurrency.ts';
import {
  createPriceRefreshExecutor,
  type PriceRefreshExecutorOptions,
} from './price-refresh-executor.ts';

interface SchedulerOptions extends PriceRefreshExecutorOptions {
  work: ReturnType<typeof createRefreshWorkRepository>;
  concurrency?: number;
  onError: () => void;
}

export function createPriceRefreshScheduler(options: SchedulerOptions) {
  const concurrency = refreshConcurrencySchema.parse(options.concurrency);
  const limit = pLimit(concurrency);
  const now = options.now ?? (() => new Date());
  const executor = createPriceRefreshExecutor({ ...options, now });
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
      const retryAt = await limit(() => executor.execute(symbol, attempt));
      if (!retryAt) {
        return;
      }
      // Waiting retries remain deduplicated, but do not occupy a provider concurrency slot.
      await waitUntilDeadline(retryAt, now);
    }
  }
}

async function waitUntilDeadline(deadline: Date, now: () => Date): Promise<void> {
  // Timers may wake before a persisted wall-clock deadline, so check again after each wait.
  while (now() < deadline) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, deadline.getTime() - now().getTime())),
    );
  }
}
