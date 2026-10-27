import {
  type PriceSnapshot as StoredPriceSnapshot,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client.js';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';

export function createMarketDataRepository(prisma: PrismaClient) {
  return {
    async readWalletPositions(userId: string, walletId: string) {
      const rows = await prisma.$queryRaw<
        { symbol: string | null; quantity: Prisma.Decimal | null }[]
      >`
        SELECT entry.symbol,
          SUM(CASE WHEN entry.side = 'BUY' THEN entry.quantity ELSE -entry.quantity END) AS quantity
        FROM wallet
        LEFT JOIN ledger_transaction entry ON entry."walletId" = wallet.id
        WHERE wallet.id = ${walletId}::uuid AND wallet."userId" = ${userId}
        GROUP BY entry.symbol
        ORDER BY entry.symbol
      `;
      if (rows.length === 0) {
        return null;
      }
      const holdings = rows.flatMap(({ symbol, quantity }) => {
        if (symbol === null) {
          return [];
        }
        return [{ symbol, quantity: quantity?.toFixed() ?? '0' }];
      });
      return { walletId, holdings };
    },
    latestPricesForSymbols: (symbols: readonly string[]) => readLatestPrices(prisma, symbols),
    async readForSymbols(symbols: readonly string[]) {
      if (symbols.length === 0) {
        return { prices: [], work: [] };
      }
      return prisma.$transaction(
        async (database) => {
          const prices = await readLatestPrices(database, symbols);
          const work = await database.refreshWork.findMany({
            where: { symbol: { in: [...symbols] } },
            select: {
              symbol: true,
              status: true,
              nextAttemptAt: true,
              lastFailureCode: true,
              leaseExpiresAt: true,
            },
          });
          return { prices, work };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}

async function readLatestPrices(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>,
  symbols: readonly string[],
): Promise<PriceSnapshot[]> {
  if (symbols.length === 0) {
    return [];
  }
  const rows = await database.$queryRaw<StoredPriceSnapshot[]>`
    SELECT DISTINCT ON ("symbol")
      "symbol", "marketDate", "unitPrice", "currency", "source", "retrievedAt"
    FROM "price_snapshot"
    WHERE "symbol" IN (${Prisma.join(symbols)})
    ORDER BY "symbol", "marketDate" DESC
  `;
  return rows.map((row) => ({
    symbol: row.symbol,
    marketDate: row.marketDate.toISOString().slice(0, 10),
    unitPrice: row.unitPrice.toFixed(),
    currency: row.currency,
    source: row.source,
    retrievedAt: row.retrievedAt,
  }));
}

export type MarketDataRepository = ReturnType<typeof createMarketDataRepository>;
