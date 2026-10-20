import type { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import type { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import type { createPriceRefreshScheduler } from './price-refresh-scheduler.ts';
import { waitUntilRefreshDeadline } from './refresh-wait.ts';

interface RecoveryOptions {
  work: Pick<ReturnType<typeof createRefreshWorkRepository>, 'unfinished'>;
  quota: Pick<ReturnType<typeof createProviderQuotaRepository>, 'read'>;
  scheduler: Pick<ReturnType<typeof createPriceRefreshScheduler>, 'enqueue'>;
  now?: () => Date;
  onError: () => void;
}

export function createPriceRefreshRecovery(options: RecoveryOptions) {
  const now = options.now ?? (() => new Date());
  const shutdown = new AbortController();
  const tasks = new Set<Promise<void>>();
  let started: Promise<void> | undefined;
  return { start, stop };

  function start(): Promise<void> {
    if (shutdown.signal.aborted) {
      return Promise.resolve();
    }
    started ??= reconstruct().catch(options.onError);
    return started;
  }

  async function reconstruct() {
    let available = (await options.quota.read()).remaining;
    if (available <= 0 || shutdown.signal.aborted) {
      return;
    }
    for await (const work of options.work.unfinished()) {
      if (shutdown.signal.aborted || available <= 0) {
        return;
      }
      available--;
      const task = restore(work).finally(() => tasks.delete(task));
      tasks.add(task);
      void task.catch(options.onError);
    }
  }

  async function restore(work: { symbol: string; notBefore: Date }) {
    if (!(await waitUntilRefreshDeadline(work.notBefore, now, shutdown.signal))) {
      return;
    }
    const quota = await options.quota.read();
    if (!shutdown.signal.aborted && quota.remaining > 0) {
      await options.scheduler.enqueue(work.symbol);
    }
  }

  async function stop() {
    shutdown.abort();
    await started;
    await Promise.allSettled(tasks);
  }
}
