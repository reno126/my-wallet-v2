import { createRequestClient } from './createRequestClient';
import { createPurchasesApi } from './purchases';
import { createWalletApi } from './wallets';

export function createRequestApi(signal: AbortSignal, baseUrl?: string) {
  const client = createRequestClient(signal, baseUrl);
  return {
    wallets: createWalletApi(client),
    purchases: createPurchasesApi(client),
  };
}
