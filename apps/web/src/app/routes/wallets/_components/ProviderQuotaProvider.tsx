import { type ReactNode, useMemo } from 'react';

import {
  ProviderQuotaContext,
  ProviderQuotaStateContext,
  useProviderQuotaController,
} from '../_hooks/useProviderQuota';

interface ProviderQuotaProviderProps {
  children: ReactNode;
}

export function ProviderQuotaProvider({ children }: ProviderQuotaProviderProps) {
  const { data, refresh, state } = useProviderQuotaController();
  const quota = useMemo(() => ({ data, refresh }), [data, refresh]);
  return (
    <ProviderQuotaContext value={quota}>
      <ProviderQuotaStateContext value={state}>{children}</ProviderQuotaStateContext>
    </ProviderQuotaContext>
  );
}
