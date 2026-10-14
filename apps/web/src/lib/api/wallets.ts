import { z as zod } from 'zod';

import {
  createWalletSchema,
  walletListQuerySchema,
  walletListSchema,
  walletSummarySchema,
} from '@my-wallets/contracts';
import { apiClient, createApiClient } from '@/api/client';

export type WalletListQuery = zod.infer<typeof walletListQuerySchema>;
export type CreateWalletInput = zod.infer<typeof createWalletSchema>;
export type WalletSummary = zod.infer<typeof walletSummarySchema>;
export type WalletList = zod.infer<typeof walletListSchema>;

type ApiClient = ReturnType<typeof createApiClient>;
type WalletApiResult<Value> = { ok: true; value: Value } | { ok: false };

export function createWalletApi(client: ApiClient = apiClient) {
  return {
    async list(query: WalletListQuery): Promise<WalletApiResult<WalletList>> {
      try {
        const result = await client.GET('/wallets', { params: { query } });

        if (result.error || result.data === undefined) {
          return { ok: false };
        }

        const parsedWalletList = walletListSchema.safeParse(result.data);

        return parsedWalletList.success
          ? { ok: true, value: parsedWalletList.data }
          : { ok: false };
      } catch {
        return { ok: false };
      }
    },

    async create(input: CreateWalletInput): Promise<WalletApiResult<WalletSummary>> {
      try {
        const body = {
          name: input.name,
          reportingCurrency: input.reportingCurrency,
          ...(input.description === undefined ? {} : { description: input.description }),
        };
        const result = await client.POST('/wallets', { body });

        if (result.error || result.data === undefined) {
          return { ok: false };
        }

        const parsedWallet = walletSummarySchema.safeParse(result.data);

        return parsedWallet.success ? { ok: true, value: parsedWallet.data } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}

export const walletsApi = createWalletApi();
