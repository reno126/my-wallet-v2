import type { z as zod } from 'zod';

import { type buyTransactionResultSchema, createBuyTransactionSchema } from '@my-wallets/contracts';

import type { ApiFailure } from '../http/api-failure.ts';
import type {
  BuyTransactionRepository,
  CreateBuyInput,
  PersistedBuy,
} from '../repositories/buy-transactions.ts';
import type { WalletRepository } from '../repositories/wallets.ts';
import { failure, type Result, success } from '../result.ts';
import type { InstrumentVerifier, VerifiedInstrument } from './instrument-verifier.ts';
import { currentMarketDate } from './market-date.ts';

type BuyResult = zod.infer<typeof buyTransactionResultSchema>;

export function createBuyTransactionService(
  dependencies: {
    wallets: Pick<WalletRepository, 'findForUser'>;
    transactions: BuyTransactionRepository;
    instruments: InstrumentVerifier;
  },
  now: () => Date = () => new Date(),
) {
  return {
    async create(
      userId: string,
      walletId: string,
      input: CreateBuyInput,
    ): Promise<Result<BuyResult, ApiFailure>> {
      const parsed = createBuyTransactionSchema.safeParse(input);
      if (!parsed.success || parsed.data.transactionDate > currentMarketDate(now())) {
        return failure({ code: 'VALIDATION_FAILED' });
      }
      // Check ownership before spending provider quota; recheck under the write lock afterwards.
      const wallet = await dependencies.wallets.findForUser(userId, walletId);
      if (!wallet) {
        return failure({ code: 'NOT_FOUND' });
      }
      const normalizedInput = { ...parsed.data, symbol: parsed.data.symbol.toUpperCase() };
      const verified = await dependencies.instruments.verify(normalizedInput.symbol);
      if (!verified.ok) {
        return verified;
      }
      const result = await dependencies.transactions.createForUser(
        userId,
        walletId,
        normalizedInput,
        verified.value,
      );
      if (!result.ok) {
        return result;
      }
      return success(toBuyResult(result.value, verified.value.quoteCurrency));
    },
  };
}

function toBuyResult(
  { transaction, holdingQuantity }: PersistedBuy,
  quoteCurrency: VerifiedInstrument['quoteCurrency'],
): BuyResult {
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
