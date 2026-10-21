import { useFetcher } from 'react-router';

import type { quotaLoader } from '../pricingResource';

export function useProviderQuota() {
  return useFetcher<typeof quotaLoader>({ key: 'provider-quota' });
}
