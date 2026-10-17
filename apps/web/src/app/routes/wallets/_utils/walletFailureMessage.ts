import { redirect } from 'react-router';

import type { WalletApiFailure } from '@/lib/api/wallets';

import { walletDictionary } from '../walletDictionary';

interface WalletFailureMessages {
  failed: string;
  unconfirmed?: string;
}

export function walletFailureMessage(
  error: WalletApiFailure,
  { failed, unconfirmed = failed }: WalletFailureMessages,
): string {
  if (error.kind !== 'http') return unconfirmed;
  if (error.status === 401) {
    throw redirect('/login');
  }
  if (error.status === 429) {
    return error.retryAfterSeconds === undefined
      ? walletDictionary.errors.rateLimited
      : walletDictionary.errors.retryAfter(error.retryAfterSeconds);
  }
  return error.status >= 500 ? unconfirmed : failed;
}
