import type { z as zod } from 'zod';

import {
  buyTransactionResultSchema,
  createBuyTransactionSchema,
  historicalPriceSchema,
  instrumentSchema,
  instrumentSearchQuerySchema,
  instrumentSearchResponseSchema,
} from '@my-wallets/contracts';

import type { RequestClient } from './createRequestClient';

export type Instrument = zod.infer<typeof instrumentSchema>;
export type HistoricalPrice = zod.infer<typeof historicalPriceSchema>;
export type BuyInput = zod.infer<typeof createBuyTransactionSchema>;

export function createPurchasesApi({ client, request }: RequestClient) {
  return {
    search(query: zod.infer<typeof instrumentSearchQuerySchema>) {
      return request(
        () => client.GET('/instruments/search', { params: { query } }),
        instrumentSearchResponseSchema,
        200,
      );
    },
    price(symbol: string, date: string) {
      return request(
        () =>
          client.GET('/instruments/{symbol}/price', {
            params: { path: { symbol }, query: { date } },
          }),
        historicalPriceSchema,
        200,
      );
    },
    buy(walletId: string, body: BuyInput) {
      const { description, ...required } = body;
      const input = { ...required, ...(description === undefined ? {} : { description }) };
      return request(
        () =>
          client.POST('/wallets/{walletId}/transactions', {
            params: { path: { walletId } },
            body: input,
          }),
        buyTransactionResultSchema,
        201,
      );
    },
  };
}
