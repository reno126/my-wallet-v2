import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import { createRequestClient } from '@/lib/api/createRequestClient';
import { createMarketDataApi } from '@/lib/api/marketData';
import type { ApiResult } from '@/lib/api/requestApiResult';

import { requireWalletId } from './_utils/requireWalletId';

function checkSession<Value>(result: ApiResult<Value>) {
  if (!result.ok && result.error.kind === 'http' && result.error.status === 401) {
    throw redirect('/login');
  }
  return result;
}

export async function quotaLoader({ request }: LoaderFunctionArgs) {
  return checkSession(await createMarketDataApi(createRequestClient(request.signal)).quota());
}

export async function pricingLoader({ request, params }: LoaderFunctionArgs) {
  const walletId = requireWalletId(params);
  const api = createMarketDataApi(createRequestClient(request.signal));
  if (new URL(request.url).searchParams.get('statusOnly') === 'true') {
    return { valuation: undefined, status: checkSession(await api.status(walletId)) };
  }
  const [valuation, status] = await Promise.all([api.valuation(walletId), api.status(walletId)]);
  return {
    valuation: checkSession(valuation),
    status: checkSession(status),
  };
}

export async function priceRefreshAction({ request, params }: ActionFunctionArgs) {
  const walletId = requireWalletId(params);
  return checkSession(
    await createMarketDataApi(createRequestClient(request.signal)).refresh(walletId),
  );
}
