import type { z as zod } from 'zod';

import type { transactionSchema } from '@my-wallets/contracts';

import type { LedgerTransaction } from '../../generated/prisma/client.js';

export function toTransactionDto(
  transaction: LedgerTransaction,
): zod.infer<typeof transactionSchema> {
  return {
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
  };
}
