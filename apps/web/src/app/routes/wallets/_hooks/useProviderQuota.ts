import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useFetcher, useLocation } from 'react-router';

import type { quotaLoader } from '../pricingResource';

export function useProviderQuotaController() {
  const { data, load, state } = useFetcher<typeof quotaLoader>({ key: 'provider-quota' });
  const { pathname } = useLocation();
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const refresh = useCallback(() => {
    if (!inFlight.current) {
      const request = load('/market-data/quota').finally(() => {
        inFlight.current = undefined;
      });
      inFlight.current = request;
    }
    return inFlight.current;
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (state !== 'idle') {
      return;
    }
    const timer = globalThis.setTimeout(() => void refresh(), 30_000);
    return () => globalThis.clearTimeout(timer);
  }, [data, refresh, state]);

  return useMemo(() => ({ data, state, refresh }), [data, state, refresh]);
}

export const ProviderQuotaContext = createContext<
  ReturnType<typeof useProviderQuotaController> | undefined
>(undefined);

export function useProviderQuota() {
  const quota = useContext(ProviderQuotaContext);
  if (!quota) {
    throw new Error('Provider quota must be used inside the authenticated layout.');
  }
  return quota;
}
