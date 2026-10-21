import type { Params } from 'react-router';

import { walletIdParamsSchema } from '@my-wallets/contracts';

import { pageFailureResponse } from '../../_utils/pageFailure';
import { walletDictionary as text } from '../walletDictionary';

export function requireWalletId(params: Params) {
  const parsed = walletIdParamsSchema.safeParse({ walletId: params['walletId'] });
  if (!parsed.success) {
    throw pageFailureResponse(404, {
      title: text.detail.unavailable,
      message: text.detail.unavailableDescription,
    });
  }
  return parsed.data.walletId;
}
