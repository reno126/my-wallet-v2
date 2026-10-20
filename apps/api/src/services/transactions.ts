import type { z as zod } from 'zod';

import { createTransactionSchema, type transactionResultSchema } from '@my-wallets/contracts';

import type { CreateTransactionCommand } from '../domain/transaction.ts';
import type { ApiFailure } from '../http/api-failure.ts';
import type { PersistedTransaction, TransactionRepository } from '../repositories/transactions.ts';
import type { WalletRepository } from '../repositories/wallets.ts';
import { failure, type Result, success } from '../result.ts';
import type { InstrumentVerifier } from './instrument-verifier.ts';
import { currentMarketDate } from './market-date.ts';

type TransactionResult = zod.infer<typeof transactionResultSchema>;
type CreateTransactionInput = zod.infer<typeof createTransactionSchema>;

export function createTransactionService(
  dependencies: {
    wallets: Pick<WalletRepository, 'findForUser'>;
    transactions: TransactionRepository;
    instruments: InstrumentVerifier;
  },
  now: () => Date = () => new Date(),
) {
  return {
    async create(
      userId: string,
      walletId: string,
      input: CreateTransactionInput,
    ): Promise<Result<TransactionResult, ApiFailure>> {
      const parsed = createTransactionSchema.safeParse(input);
      if (!parsed.success || parsed.data.transactionDate > currentMarketDate(now())) {
        return failure({ code: 'VALIDATION_FAILED' });
      }
      // Check ownership before spending provider quota; recheck under the write lock afterwards.
      const wallet = await dependencies.wallets.findForUser(userId, walletId);
      if (!wallet) {
        return failure({ code: 'NOT_FOUND' });
      }
      const prepared = await prepareTransactionCommand(parsed.data, dependencies.instruments);
      if (!prepared.ok) {
        return prepared;
      }
      const result = await dependencies.transactions.createForUser(
        userId,
        walletId,
        prepared.value,
      );
      if (!result.ok) {
        return result;
      }
      return success(toTransactionResult(result.value));
    },
  };
}

async function prepareTransactionCommand(
  input: CreateTransactionInput,
  instruments: InstrumentVerifier,
): Promise<Result<CreateTransactionCommand, ApiFailure>> {
  const normalized = { ...input, symbol: input.symbol.toUpperCase() };
  if (normalized.side === 'SELL') {
    return success({ ...normalized, side: 'SELL' });
  }
  const verified = await instruments.verify(normalized.symbol);
  if (!verified.ok) {
    return verified;
  }
  return success({ ...normalized, side: 'BUY', instrument: verified.value });
}

function toTransactionResult({
  transaction,
  holdingQuantity,
  quoteCurrency,
}: PersistedTransaction): TransactionResult {
  return {
    transaction: {
      id: transaction.id,
      walletId: transaction.walletId,
      symbol: transaction.symbol,
      side: transaction.side,
      transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
      quantity: transaction.quantity.toFixed(),
      unitPrice: transaction.unitPrice.toFixed(),
      currency: transaction.currency,
      ...(transaction.description === null ? {} : { description: transaction.description }),
      createdAt: transaction.createdAt.toISOString(),
    },
    holding: {
      walletId: transaction.walletId,
      symbol: transaction.symbol,
      quantity: holdingQuantity,
      quoteCurrency,
    },
  };
}
