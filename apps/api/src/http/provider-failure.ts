import type { FmpFailure } from '../providers/fmp/client.js';

interface ProviderFailure {
  code:
    | 'PROVIDER_UNAVAILABLE'
    | 'PROVIDER_QUOTA_EXHAUSTED'
    | 'PROVIDER_ERROR'
    | 'PROVIDER_PAYMENT_REQUIRED'
    | 'PROVIDER_TIMEOUT';
}

export function mapProviderFailure(failure: FmpFailure): ProviderFailure {
  switch (failure.code) {
    case 'QUOTA_EXHAUSTED':
      return { code: 'PROVIDER_QUOTA_EXHAUSTED' };
    case 'NOT_CONFIGURED':
    case 'QUOTA_UNAVAILABLE':
      return { code: 'PROVIDER_UNAVAILABLE' };
    case 'TIMEOUT':
      return { code: 'PROVIDER_TIMEOUT' };
    case 'HTTP_ERROR':
      return { code: failure.status === 402 ? 'PROVIDER_PAYMENT_REQUIRED' : 'PROVIDER_ERROR' };
    default:
      return { code: 'PROVIDER_ERROR' };
  }
}
