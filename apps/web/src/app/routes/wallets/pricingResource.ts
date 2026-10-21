import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

import { walletIdParamsSchema } from '@my-wallets/contracts';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createMarketDataApi } from '@/lib/api/marketData';
import type { ApiResult } from '@/lib/api/requestApiResult';

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
  const { walletId } = walletIdParamsSchema.parse(params);
  const api = createMarketDataApi(createRequestClient(request.signal));
  const [valuation, status] = await Promise.all([api.valuation(walletId), api.status(walletId)]);
  return {
    valuation: checkSession(valuation),
    status: checkSession(status),
  };
}

export async function priceRefreshAction({ request, params }: ActionFunctionArgs) {
  const { walletId } = walletIdParamsSchema.parse(params);
  return checkSession(
    await createMarketDataApi(createRequestClient(request.signal)).refresh(walletId),
  );
}
