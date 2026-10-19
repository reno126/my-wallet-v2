import type { LoaderFunctionArgs } from 'react-router';

import { walletIdParamsSchema } from '@my-wallets/contracts';
import { walletsApi } from '@/lib/api/wallets';

import { pageFailureResponse } from '../../_utils/pageFailure';
import { requirePageData } from '../../_utils/requirePageData';
import { walletDictionary as text } from '../walletDictionary';

export async function loadWallet({ request, params }: LoaderFunctionArgs) {
  const notFound = { title: text.detail.unavailable, message: text.detail.unavailableDescription };
  const parsed = walletIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw pageFailureResponse(404, notFound);
  }
  const result = await walletsApi.read(parsed.data.walletId, request.signal);
  return requirePageData(result, {
    title: text.detail.title,
    message: text.detail.loadFailed,
    notFound,
    hideForbidden: true,
  });
}
