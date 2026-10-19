import { z as zod } from 'zod';

import {
  createWalletSchema,
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';

import type { RequestClient } from './createRequestClient';
import type { ApiFailure, ApiResult } from './requestApiResult';

export type WalletListQuery = zod.infer<typeof walletListQuerySchema>;
export type CreateWalletInput = zod.infer<typeof createWalletSchema>;
export type WalletSummary = zod.infer<typeof walletSummarySchema>;
export type WalletList = zod.infer<typeof walletListSchema>;

export type WalletApiFailure = ApiFailure;

export function createWalletApi({ client, request }: RequestClient) {
  return {
    list(query: WalletListQuery): Promise<ApiResult<WalletList>> {
      return request(() => client.GET('/wallets', { params: { query } }), walletListSchema);
    },
    read(walletId: string): Promise<ApiResult<WalletSummary>> {
      return request(
        () =>
          client.GET('/wallets/{walletId}', {
            params: { path: { walletId } },
          }),
        walletSummarySchema,
      );
    },
    delete(walletId: string): Promise<ApiResult<undefined>> {
      return request(
        () =>
          client.DELETE('/wallets/{walletId}', {
            params: { path: { walletId } },
          }),
        zod.undefined(),
        204,
      );
    },
    create(input: CreateWalletInput): Promise<ApiResult<WalletSummary>> {
      const body = {
        name: input.name,
        reportingCurrency: input.reportingCurrency,
        ...(input.description === undefined ? {} : { description: input.description }),
      };
      return request(() => client.POST('/wallets', { body }), walletSummarySchema);
    },
  };
}
