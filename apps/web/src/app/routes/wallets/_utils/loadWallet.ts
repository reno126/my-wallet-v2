import type { LoaderFunctionArgs } from 'react-router';

import { createRequestClient } from '@/lib/api/createRequestClient';
import { createWalletApi } from '@/lib/api/wallets';

import { requirePageData } from '../../_utils/requirePageData';
import { walletDictionary as text } from '../walletDictionary';
import { requireWalletId } from './requireWalletId';

export async function loadWallet(
  { request, params }: LoaderFunctionArgs,
  client = createRequestClient(request.signal),
) {
  const notFound = { title: text.detail.unavailable, message: text.detail.unavailableDescription };
  const walletId = requireWalletId(params);
  const wallets = createWalletApi(client);
  const result = await wallets.read(walletId);
  return requirePageData(result, {
    title: text.detail.title,
    message: text.detail.loadFailed,
    notFound,
    hideForbidden: true,
  });
}
