import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import { normalizedInstrumentSymbolSchema } from '../schemas/instrument-symbol.ts';
import { priceSnapshotSchema } from '../schemas/price-snapshot.ts';

export function createPriceCacheRepository(prisma: PrismaClient) {
  return {
    save: (snapshot: PriceSnapshot) => savePriceSnapshot(prisma, snapshot),
    async latest(symbol: string): Promise<PriceSnapshot | null> {
      const snapshot = await prisma.priceSnapshot.findFirst({
        where: { symbol: normalizedInstrumentSymbolSchema.parse(symbol) },
        orderBy: { marketDate: 'desc' },
      });
      return snapshot
        ? {
            ...snapshot,
            marketDate: snapshot.marketDate.toISOString().slice(0, 10),
            unitPrice: snapshot.unitPrice.toFixed(),
          }
        : null;
    },
  };
}

export async function savePriceSnapshot(
  database: Pick<Prisma.TransactionClient, '$executeRaw'>,
  input: PriceSnapshot,
): Promise<boolean> {
  const snapshot = priceSnapshotSchema.parse(input);
  const date = new Date(`${snapshot.marketDate}T00:00:00.000Z`);
  const changed = await database.$executeRaw`
    INSERT INTO "price_snapshot" ("symbol", "marketDate", "unitPrice", "currency", "source", "retrievedAt")
    VALUES (${snapshot.symbol}, ${date}, ${snapshot.unitPrice}::numeric,
      ${snapshot.currency}::"CurrencyCode", ${snapshot.source}::"PriceSource", ${snapshot.retrievedAt})
    ON CONFLICT ("symbol", "marketDate") DO UPDATE
    SET "unitPrice" = EXCLUDED."unitPrice", "currency" = EXCLUDED."currency",
      "source" = EXCLUDED."source", "retrievedAt" = EXCLUDED."retrievedAt"
    WHERE "price_snapshot"."retrievedAt" < EXCLUDED."retrievedAt"
  `;
  return changed === 1;
}
