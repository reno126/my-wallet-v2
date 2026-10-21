import {
  type PriceSnapshot as StoredPriceSnapshot,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client.js';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';

export function createMarketDataRepository(prisma: PrismaClient) {
  return {
    async readForSymbols(symbols: readonly string[]) {
      if (symbols.length === 0) {
        return { prices: [], work: [] };
      }
      return prisma.$transaction(
        async (database) => {
          const rows = await database.$queryRaw<StoredPriceSnapshot[]>`
          SELECT DISTINCT ON ("symbol") * FROM "price_snapshot"
          WHERE "symbol" IN (${Prisma.join(symbols)})
          ORDER BY "symbol", "marketDate" DESC
        `;
          const prices: PriceSnapshot[] = rows.map((row) => ({
            ...row,
            marketDate: row.marketDate.toISOString().slice(0, 10),
            unitPrice: row.unitPrice.toFixed(),
          }));
          const work = await database.refreshWork.findMany({
            where: { symbol: { in: [...symbols] } },
            select: { symbol: true, status: true, nextAttemptAt: true, lastFailureCode: true },
          });
          return { prices, work };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}

export type MarketDataRepository = ReturnType<typeof createMarketDataRepository>;
