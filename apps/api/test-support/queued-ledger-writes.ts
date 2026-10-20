import { expect, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';

export async function runQueuedLedgerWrites<Value>(
  prisma: PrismaClient,
  walletId: string,
  queuedCount: number,
  startWrites: () => Promise<Value>,
): Promise<Value> {
  let notifyLocked: (backendPid: number) => void = () => {};
  let releaseLock = () => {};
  const locked = new Promise<number>((resolve) => {
    notifyLocked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const lockTransaction = prisma.$transaction(
    async (database) => {
      const [row] = await database.$queryRaw<{ backendPid: number }[]>`
      SELECT pg_backend_pid() AS "backendPid" FROM "wallet"
      WHERE "id" = ${walletId}::uuid FOR UPDATE
    `;
      if (!row) {
        throw new Error('The concurrency fixture wallet is missing.');
      }
      notifyLocked(row.backendPid);
      await released;
    },
    { timeout: 10_000 },
  );
  const backendPid = await Promise.race([
    locked,
    lockTransaction.then(() => {
      throw new Error('The wallet lock ended before acquisition.');
    }),
  ]);
  const writes = Promise.resolve().then(startWrites);
  try {
    await vi.waitFor(
      async () => {
        const [waiting] = await prisma.$queryRaw<{ count: number }[]>`
        WITH RECURSIVE blocked AS (
          SELECT pid FROM pg_stat_activity WHERE ${backendPid} = ANY(pg_blocking_pids(pid))
          UNION
          SELECT activity.pid FROM pg_stat_activity AS activity
          JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        )
        SELECT COUNT(*)::int AS count FROM blocked
      `;
        expect(waiting?.count).toBeGreaterThanOrEqual(queuedCount);
      },
      { timeout: 3_000, interval: 25 },
    );
  } finally {
    releaseLock();
    await lockTransaction;
    await writes;
  }
  return writes;
}
