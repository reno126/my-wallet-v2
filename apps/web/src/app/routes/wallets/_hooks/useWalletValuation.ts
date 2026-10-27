import { useState } from 'react';

import type { WalletValuation } from '@/lib/api/marketData';
import type { ApiResult } from '@/lib/api/requestApiResult';

import { retainValuationReferences } from '../_utils/retainValuationReferences';

interface ValuationCache {
  source: ApiResult<WalletValuation> | undefined;
  value: WalletValuation | undefined;
}

export function useWalletValuation(
  walletId: string,
  source: ApiResult<WalletValuation> | undefined,
) {
  const [cache, setCache] = useState<ValuationCache>({ source: undefined, value: undefined });
  if (source !== cache.source) {
    const next = source?.ok && source.value.walletId === walletId ? source.value : cache.value;
    setCache({ source, value: retainValuationReferences(cache.value, next) });
  }
  return cache.value?.walletId === walletId ? cache.value : undefined;
}
