import type { z as zod } from 'zod';

import type { createBuyTransactionSchema } from '@my-wallets/contracts';

import type {
  CurrencyCode,
  LedgerTransaction,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { ApiFailure } from '../http/api-failure.js';
import { failure, type Result, success } from '../result.ts';
import type { VerifiedInstrument } from '../services/instrument-verifier.js';

export type CreateBuyInput = zod.infer<typeof createBuyTransactionSchema>;
export interface PersistedBuy {
  transaction: LedgerTransaction;
  holdingQuantity: string;
}

export function createBuyTransactionRepository(prisma: PrismaClient) {
  return {
    async createForUser(
      userId: string,
      walletId: string,
      input: CreateBuyInput,
      instrument: VerifiedInstrument,
    ): Promise<Result<PersistedBuy, ApiFailure>> {
      return prisma.$transaction(async (database) => {
        // Wallet locking also serializes BUYs with permanent wallet deletion.
        const [wallet] = await database.$queryRaw<{ reportingCurrency: CurrencyCode }[]>`
          SELECT "reportingCurrency" FROM "wallet"
          WHERE "id" = ${walletId}::uuid AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (!wallet) return failure({ code: 'NOT_FOUND' });
        if (
          wallet.reportingCurrency !== input.currency ||
          instrument.quoteCurrency !== input.currency
        )
          return failure({ code: 'CURRENCY_MISMATCH' });

        await database.instrument.upsert({
          where: { symbol: instrument.symbol },
          create: instrument,
          update: { name: instrument.name, exchange: instrument.exchange },
        });
        const transaction = await database.ledgerTransaction.create({
          data: {
            walletId,
            symbol: instrument.symbol,
            side: 'BUY',
            transactionDate: new Date(`${input.transactionDate}T00:00:00.000Z`),
            quantity: input.quantity,
            unitPrice: input.unitPrice,
            currency: input.currency,
            description: input.description ?? null,
          },
        });
        // PostgreSQL sums NUMERIC exactly, including totals beyond a single input's range.
        const totals = await database.ledgerTransaction.aggregate({
          where: { walletId, symbol: instrument.symbol },
          _sum: { quantity: true },
        });
        if (totals._sum.quantity === null) throw new Error('Created BUY has no ledger quantity.');
        return success({ transaction, holdingQuantity: totals._sum.quantity.toFixed() });
      });
    },
  };
}

export type BuyTransactionRepository = ReturnType<typeof createBuyTransactionRepository>;
