import type { LoaderFunctionArgs } from 'react-router';

import { walletIdParamsSchema } from '@my-wallets/contracts';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createWalletApi } from '@/lib/api/wallets';

import { pageFailureResponse } from '../../_utils/pageFailure';
import { requirePageData } from '../../_utils/requirePageData';
import { walletDictionary as text } from '../walletDictionary';

export async function loadWallet(
  { request, params }: LoaderFunctionArgs,
  client = createRequestClient(request.signal),
) {
  const notFound = { title: text.detail.unavailable, message: text.detail.unavailableDescription };
  const parsed = walletIdParamsSchema.safeParse({ walletId: params['walletId'] });
  if (!parsed.success) {
    throw pageFailureResponse(404, notFound);
  }
  const wallets = createWalletApi(client);
  const result = await wallets.read(parsed.data.walletId);
  return requirePageData(result, {
    title: text.detail.title,
    message: text.detail.loadFailed,
    notFound,
    hideForbidden: true,
  });
}
