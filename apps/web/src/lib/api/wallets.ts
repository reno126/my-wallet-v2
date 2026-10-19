import { z as zod } from 'zod';

import {
  createWalletSchema,
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';
import { apiClient, createApiClient } from '@/api/client';

import { type ApiFailure, type ApiResult, requestApiResult } from './requestApiResult';

export type WalletListQuery = zod.infer<typeof walletListQuerySchema>;
export type CreateWalletInput = zod.infer<typeof createWalletSchema>;
export type WalletSummary = zod.infer<typeof walletSummarySchema>;
export type WalletList = zod.infer<typeof walletListSchema>;

export type WalletApiFailure = ApiFailure;
type ApiClient = ReturnType<typeof createApiClient>;

export function createWalletApi(client: ApiClient = apiClient) {
  return {
    list(query: WalletListQuery, signal?: AbortSignal): Promise<ApiResult<WalletList>> {
      return requestApiResult(
        () => client.GET('/wallets', { params: { query }, signal: signal ?? null }),
        walletListSchema,
        signal,
      );
    },
    read(walletId: string, signal?: AbortSignal): Promise<ApiResult<WalletSummary>> {
      return requestApiResult(
        () =>
          client.GET('/wallets/{walletId}', {
            params: { path: { walletId } },
            signal: signal ?? null,
          }),
        walletSummarySchema,
        signal,
      );
    },
    delete(walletId: string, signal?: AbortSignal): Promise<ApiResult<undefined>> {
      return requestApiResult(
        () =>
          client.DELETE('/wallets/{walletId}', {
            params: { path: { walletId } },
            signal: signal ?? null,
          }),
        zod.undefined(),
        signal,
        204,
      );
    },
    create(input: CreateWalletInput, signal?: AbortSignal): Promise<ApiResult<WalletSummary>> {
      const body = {
        name: input.name,
        reportingCurrency: input.reportingCurrency,
        ...(input.description === undefined ? {} : { description: input.description }),
      };
      return requestApiResult(
        () => client.POST('/wallets', { body, signal: signal ?? null }),
        walletSummarySchema,
        signal,
      );
    },
  };
}

export const walletsApi = createWalletApi();
