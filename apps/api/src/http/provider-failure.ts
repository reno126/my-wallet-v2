import type { FmpFailure } from '../providers/fmp/client.js';
import type { ApiFailure } from './api-failure.js';

export function mapProviderFailure(failure: FmpFailure): ApiFailure {
  switch (failure.code) {
    case 'QUOTA_EXHAUSTED':
      return { code: 'PROVIDER_QUOTA_EXHAUSTED' };
    case 'NOT_CONFIGURED':
    case 'QUOTA_UNAVAILABLE':
      return { code: 'PROVIDER_UNAVAILABLE' };
    case 'TIMEOUT':
      return { code: 'PROVIDER_TIMEOUT' };
    default:
      return { code: 'PROVIDER_ERROR' };
  }
}
