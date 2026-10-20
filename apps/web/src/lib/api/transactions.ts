import { z as zod } from 'zod';

import { createTransactionSchema, transactionResultSchema } from '@my-wallets/contracts';

import type { RequestClient } from './createRequestClient';

export const sellTransactionSchema = createTransactionSchema.extend({ side: zod.literal('SELL') });

export function createTransactionsApi({ client, request }: RequestClient) {
  return {
    sell(walletId: string, body: zod.infer<typeof sellTransactionSchema>) {
      const { description, ...required } = body;
      return request(
        () =>
          client.POST('/wallets/{walletId}/transactions', {
            params: { path: { walletId } },
            body: { ...required, ...(description === undefined ? {} : { description }) },
          }),
        transactionResultSchema,
        201,
      );
    },
    delete(walletId: string, transactionId: string) {
      return request(
        () =>
          client.DELETE('/wallets/{walletId}/transactions/{transactionId}', {
            params: { path: { walletId, transactionId } },
          }),
        zod.undefined(),
        204,
      );
    },
  };
}
