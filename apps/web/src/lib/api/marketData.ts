import type { z as zod } from 'zod';

import {
  priceRefreshReceiptSchema,
  providerQuotaStatusSchema,
  walletRefreshStatusSchema,
  walletValuationSchema,
} from '@my-wallets/contracts';

import type { RequestClient } from './createRequestClient';

export type WalletValuation = zod.infer<typeof walletValuationSchema>;
export type HoldingValuation = WalletValuation['holdings'][number];
export type WalletRefreshStatus = zod.infer<typeof walletRefreshStatusSchema>;
export type ProviderQuota = zod.infer<typeof providerQuotaStatusSchema>;

export function createMarketDataApi({ client, request }: RequestClient) {
  return {
    valuation(walletId: string) {
      return request(
        () => client.GET('/wallets/{walletId}/valuation', { params: { path: { walletId } } }),
        walletValuationSchema,
        200,
      );
    },
    status(walletId: string) {
      return request(
        () => client.GET('/wallets/{walletId}/price-refresh', { params: { path: { walletId } } }),
        walletRefreshStatusSchema,
        200,
      );
    },
    refresh(walletId: string) {
      return request(
        () =>
          client.POST('/wallets/{walletId}/price-refresh', {
            params: { path: { walletId } },
            body: {},
          }),
        priceRefreshReceiptSchema,
        202,
      );
    },
    quota() {
      return request(() => client.GET('/market-data/quota'), providerQuotaStatusSchema, 200);
    },
  };
}
