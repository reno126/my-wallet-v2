import type { PrismaClient } from '../../generated/prisma/client.js';

export function createLedgerRepository(prisma: PrismaClient) {
  return {
    readForUser(userId: string, walletId: string, symbol?: string) {
      // Parent ownership and all relation queries observe the same committed snapshot.
      // Readers do not acquire the wallet lock used to serialize ledger mutations.
      return prisma.$transaction(
        (database) =>
          database.wallet.findFirst({
            where: { id: walletId, userId },
            select: {
              id: true,
              reportingCurrency: true,
              transactions: {
                ...(symbol === undefined ? {} : { where: { symbol } }),
                include: { instrument: true },
              },
            },
          }),
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}

export type LedgerRepository = ReturnType<typeof createLedgerRepository>;
export type LedgerSnapshot = NonNullable<Awaited<ReturnType<LedgerRepository['readForUser']>>>;
