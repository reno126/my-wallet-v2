import type { z as zod } from 'zod';

import type { createTransactionSchema } from '@my-wallets/contracts';

import type {
  CurrencyCode,
  LedgerTransaction,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import { calculatePosition, type PositionScope } from '../domain/accounting/position.ts';
import type { ApiFailure } from '../http/api-failure.js';
import { failure, type Result, success } from '../result.ts';
import type { VerifiedInstrument } from '../services/instrument-verifier.js';

export type CreateTransactionInput = zod.infer<typeof createTransactionSchema>;
export interface PersistedTransaction {
  transaction: LedgerTransaction;
  holdingQuantity: string;
  quoteCurrency: CurrencyCode;
}

// Prisma rolls back interactive transactions only on rejection. Keep this internal;
// expected ledger conflicts still cross the repository boundary as Result failures.
class InsufficientHoldingError extends Error {}

export function createTransactionRepository(prisma: PrismaClient) {
  return {
    async createForUser(
      userId: string,
      walletId: string,
      input: CreateTransactionInput,
      verifiedInstrument?: VerifiedInstrument,
    ): Promise<Result<PersistedTransaction, ApiFailure>> {
      try {
        return await prisma.$transaction(
          async (database) => {
            // All ledger writes share this lock, including BUYs and wallet deletion.
            const [wallet] = await database.$queryRaw<{ reportingCurrency: CurrencyCode }[]>`
              SELECT "reportingCurrency" FROM "wallet"
              WHERE "id" = ${walletId}::uuid AND "userId" = ${userId}
              FOR UPDATE
            `;
            if (!wallet) {
              return failure({ code: 'NOT_FOUND' });
            }
            if (input.side === 'BUY' && verifiedInstrument === undefined) {
              throw new Error('A purchase requires a verified instrument.');
            }
            const instrument =
              input.side === 'BUY'
                ? verifiedInstrument
                : await database.instrument.findUnique({ where: { symbol: input.symbol } });
            if (!instrument) {
              return failure({ code: 'INSUFFICIENT_HOLDING' });
            }
            if (instrument.symbol !== input.symbol) {
              throw new Error('The verified instrument does not match the requested symbol.');
            }
            if (
              wallet.reportingCurrency !== input.currency ||
              instrument.quoteCurrency !== input.currency
            ) {
              return failure({ code: 'CURRENCY_MISMATCH' });
            }

            if (input.side === 'BUY') {
              await database.instrument.upsert({
                where: { symbol: instrument.symbol },
                create: instrument,
                update: { name: instrument.name, exchange: instrument.exchange },
              });
            }
            const transaction = await database.ledgerTransaction.create({
              data: {
                walletId,
                symbol: instrument.symbol,
                side: input.side,
                transactionDate: new Date(`${input.transactionDate}T00:00:00.000Z`),
                quantity: input.quantity,
                unitPrice: input.unitPrice,
                currency: input.currency,
                description: input.description ?? null,
              },
            });
            const holdingQuantity = await calculatePersistedHolding(database, {
              walletId,
              symbol: instrument.symbol,
              currency: wallet.reportingCurrency,
            });
            return success({
              transaction,
              holdingQuantity,
              quoteCurrency: instrument.quoteCurrency,
            });
          },
          { isolationLevel: 'ReadCommitted' },
        );
      } catch (error) {
        if (error instanceof InsufficientHoldingError) {
          return failure({ code: 'INSUFFICIENT_HOLDING' });
        }
        throw error;
      }
    },
  };
}

export type TransactionRepository = ReturnType<typeof createTransactionRepository>;

async function calculatePersistedHolding(
  database: Prisma.TransactionClient,
  scope: PositionScope,
): Promise<string> {
  const ledger = await database.ledgerTransaction.findMany({
    where: { walletId: scope.walletId, symbol: scope.symbol },
    omit: { description: true },
  });
  const position = calculatePosition(
    scope,
    ledger.map((entry) => ({
      ...entry,
      transactionDate: entry.transactionDate.toISOString().slice(0, 10),
      quantity: entry.quantity.toFixed(),
      unitPrice: entry.unitPrice.toFixed(),
    })),
  );
  if (!position.ok) {
    if (position.error.code === 'INSUFFICIENT_HOLDING') {
      throw new InsufficientHoldingError();
    }
    throw new Error('The persisted ledger is invalid for accounting.');
  }
  return position.value.quantity;
}
