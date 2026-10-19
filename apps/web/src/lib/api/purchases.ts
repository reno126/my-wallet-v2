import type { z as zod } from 'zod';

import {
  buyTransactionResultSchema,
  createBuyTransactionSchema,
  historicalPriceSchema,
  instrumentSchema,
  instrumentSearchQuerySchema,
  instrumentSearchResponseSchema,
} from '@my-wallets/contracts';
import { apiClient, type createApiClient } from '@/api/client';

import { requestApiResult } from './requestApiResult';

export type Instrument = zod.infer<typeof instrumentSchema>;
export type HistoricalPrice = zod.infer<typeof historicalPriceSchema>;
export type BuyInput = zod.infer<typeof createBuyTransactionSchema>;

export function createPurchasesApi(client: ReturnType<typeof createApiClient> = apiClient) {
  return {
    search(query: zod.infer<typeof instrumentSearchQuerySchema>, signal?: AbortSignal) {
      return requestApiResult(
        () => client.GET('/instruments/search', { params: { query }, signal: signal ?? null }),
        instrumentSearchResponseSchema,
        signal,
        200,
      );
    },
    price(symbol: string, date: string, signal?: AbortSignal) {
      return requestApiResult(
        () =>
          client.GET('/instruments/{symbol}/price', {
            params: { path: { symbol }, query: { date } },
            signal: signal ?? null,
          }),
        historicalPriceSchema,
        signal,
        200,
      );
    },
    buy(walletId: string, body: BuyInput, signal?: AbortSignal) {
      const { description, ...required } = body;
      const input = { ...required, ...(description === undefined ? {} : { description }) };
      return requestApiResult(
        () =>
          client.POST('/wallets/{walletId}/transactions', {
            params: { path: { walletId } },
            body: input,
            signal: signal ?? null,
          }),
        buyTransactionResultSchema,
        signal,
        201,
      );
    },
  };
}

export const purchasesApi = createPurchasesApi();
