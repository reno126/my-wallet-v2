import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import type { ApiFailure } from '../http/api-failure.js';
import { normalizedInstrumentSymbolSchema } from '../schemas/instrument-symbol.ts';
import { savePriceSnapshot } from './price-cache.ts';

export interface RefreshLease {
  symbol: string;
  token: string;
  expiresAt: Date;
  attempt: number;
}

export function createRefreshWorkRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
) {
  return { requestForWallet, claim, complete, fail, unfinished };

  async function requestForWallet(
    userId: string,
    walletId: string,
    inputSymbol: string,
  ): Promise<boolean> {
    return prisma.$transaction(async (database) => {
      // Coordinate subscription creation with wallet deletion, without owning the shared work.
      const wallets = await database.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "wallet" WHERE "id" = ${walletId}::uuid AND "userId" = ${userId}
        FOR KEY SHARE
      `;
      if (wallets.length === 0) {
        return false;
      }
      const symbol = normalizedInstrumentSymbolSchema.parse(inputSymbol);
      const instant = now();
      await database.$executeRaw`
        INSERT INTO "refresh_work" ("symbol", "status", "requestedAt", "updatedAt", "attempts")
        VALUES (${symbol}, 'PENDING', ${instant}, ${instant}, 0)
        ON CONFLICT ("symbol") DO UPDATE
        SET "requestedAt" = EXCLUDED."requestedAt", "updatedAt" = EXCLUDED."updatedAt",
          "attempts" = CASE WHEN "refresh_work"."status" = 'SUCCEEDED'
            OR ("refresh_work"."status" = 'FAILED' AND
              ("refresh_work"."nextAttemptAt" IS NULL OR "refresh_work"."nextAttemptAt" <= ${instant}))
            THEN 0 ELSE "refresh_work"."attempts" END,
          "status" = CASE WHEN "refresh_work"."status" = 'RUNNING'
            OR ("refresh_work"."status" = 'FAILED' AND "refresh_work"."nextAttemptAt" > ${instant})
            THEN "refresh_work"."status" ELSE 'PENDING'::"RefreshStatus" END
      `;
      await database.refreshSubscription.upsert({
        where: { walletId_symbol: { walletId, symbol } },
        create: { walletId, symbol },
        update: {},
      });
      return true;
    });
  }

  async function claim(inputSymbol: string, leaseMs: number): Promise<RefreshLease | null> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) {
      throw new RangeError('Refresh leases must last from 1 to 300000 milliseconds.');
    }
    const symbol = normalizedInstrumentSymbolSchema.parse(inputSymbol);
    const instant = now();
    const token = randomUUID();
    const expiresAt = new Date(instant.getTime() + leaseMs);
    const claimed = await prisma.refreshWork.updateManyAndReturn({
      select: { attempts: true },
      where: {
        symbol,
        subscriptions: { some: {} },
        OR: [
          {
            status: { in: ['PENDING', 'FAILED'] },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: instant } }],
          },
          { status: 'RUNNING', leaseExpiresAt: { lte: instant } },
        ],
      },
      data: {
        status: 'RUNNING',
        leaseToken: token,
        leaseExpiresAt: expiresAt,
        nextAttemptAt: null,
        attempts: { increment: 1 },
        updatedAt: instant,
      },
    });
    const work = claimed[0];
    return work ? { symbol, token, expiresAt, attempt: work.attempts } : null;
  }

  async function complete(lease: RefreshLease, snapshot: Omit<PriceSnapshot, 'symbol'>) {
    return prisma.$transaction(async (database) => {
      const changed = await database.refreshWork.updateMany({
        where: activeLease(lease, now()),
        data: {
          status: 'SUCCEEDED',
          leaseToken: null,
          leaseExpiresAt: null,
          lastFailureCode: null,
          nextAttemptAt: null,
          updatedAt: now(),
        },
      });
      if (changed.count === 0) {
        return false;
      }
      await savePriceSnapshot(database, { ...snapshot, symbol: lease.symbol });
      return true;
    });
  }

  async function fail(
    lease: RefreshLease,
    code: ApiFailure['code'],
    nextAttemptAt: Date,
    options: { retry: boolean } = { retry: false },
  ) {
    const instant = now();
    const changed = await prisma.refreshWork.updateMany({
      where: activeLease(lease, instant),
      data: {
        status: options.retry ? 'PENDING' : 'FAILED',
        leaseToken: null,
        leaseExpiresAt: null,
        lastFailureCode: code,
        nextAttemptAt,
        updatedAt: instant,
      },
    });
    return changed.count === 1;
  }

  async function* unfinished(): AsyncGenerator<{ symbol: string; notBefore: Date }> {
    let after: string | undefined;
    for (;;) {
      const rows = await prisma.refreshWork.findMany({
        where: {
          status: { in: ['PENDING', 'RUNNING'] },
          subscriptions: { some: {} },
          ...(after === undefined ? {} : { symbol: { gt: after } }),
        },
        select: { symbol: true, status: true, nextAttemptAt: true, leaseExpiresAt: true },
        orderBy: { symbol: 'asc' },
        take: 100,
      });
      for (const row of rows) {
        yield {
          symbol: row.symbol,
          notBefore: (row.status === 'RUNNING' ? row.leaseExpiresAt : row.nextAttemptAt) ?? now(),
        };
      }
      const last = rows.at(-1);
      if (rows.length < 100 || !last) {
        return;
      }
      after = last.symbol;
    }
  }
}

function activeLease(lease: RefreshLease, instant: Date): Prisma.RefreshWorkWhereInput {
  return {
    symbol: lease.symbol,
    status: 'RUNNING',
    leaseToken: lease.token,
    leaseExpiresAt: { gt: instant },
  };
}
