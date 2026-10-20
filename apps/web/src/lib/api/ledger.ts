import type { z as zod } from 'zod';

import {
  holdingSchema,
  transactionListQuerySchema,
  transactionListSchema,
  walletHoldingsSchema,
} from '@my-wallets/contracts';

import type { RequestClient } from './createRequestClient';

export type Holding = zod.infer<typeof holdingSchema>;
export type WalletHoldings = zod.infer<typeof walletHoldingsSchema>;
export type TransactionHistory = zod.infer<typeof transactionListSchema>;
export type HistoryEntry = TransactionHistory['transactions'][number];

export function createLedgerApi({ client, request }: RequestClient) {
  return {
    holdings(walletId: string) {
      return request(
        () => client.GET('/wallets/{walletId}/holdings', { params: { path: { walletId } } }),
        walletHoldingsSchema,
        200,
      );
    },
    holding(walletId: string, symbol: string) {
      return request(
        () =>
          client.GET('/wallets/{walletId}/holdings/{symbol}', {
            params: { path: { walletId, symbol } },
          }),
        holdingSchema,
        200,
      );
    },
    history(walletId: string, query: zod.infer<typeof transactionListQuerySchema>) {
      const { symbol, ...pagination } = query;
      return request(
        () =>
          client.GET('/wallets/{walletId}/transactions', {
            params: {
              path: { walletId },
              query: { ...pagination, ...(symbol === undefined ? {} : { symbol }) },
            },
          }),
        transactionListSchema,
        200,
      );
    },
  };
}
