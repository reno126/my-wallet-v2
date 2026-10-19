import { redirect } from 'react-router';

import type { ApiFailure } from '@/lib/api/requestApiResult';

import { purchaseDictionary as text } from '../purchaseDictionary';

export function purchaseFailureMessage(error: ApiFailure, operation: 'search' | 'price' | 'buy') {
  if (operation === 'buy' && isUnconfirmedPurchaseFailure(error)) return text.errors.unconfirmed;
  if (error.kind !== 'http') return text.errors[operation];
  if (error.status === 401) throw redirect('/login');
  if (error.status === 429)
    return error.retryAfterSeconds === undefined
      ? text.errors.rateLimited
      : text.errors.retryAfter(error.retryAfterSeconds);
  switch (error.code) {
    case 'PROVIDER_QUOTA_EXHAUSTED':
      return text.errors.quota;
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_ERROR':
    case 'PROVIDER_TIMEOUT':
      return text.errors.provider;
    case 'UNSUPPORTED_CURRENCY':
    case 'CURRENCY_UNAVAILABLE':
    case 'CURRENCY_MISMATCH':
      return text.errors.currency;
    case 'UNSUPPORTED_INSTRUMENT':
      return text.errors.instrument;
    case 'PRICE_NOT_AVAILABLE':
      return text.errors.noPrice;
    case 'PRICE_LOOKUP_INCOMPLETE':
      return text.errors.incomplete;
  }
  if (operation === 'buy' && [403, 404].includes(error.status)) return text.errors.unavailable;
  return text.errors[operation];
}

export function isUnconfirmedPurchaseFailure(error: ApiFailure): boolean {
  if (error.kind !== 'http') return true;
  const rejectedBeforePersistence =
    error.code !== undefined &&
    [
      'PROVIDER_QUOTA_EXHAUSTED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_ERROR',
      'PROVIDER_TIMEOUT',
    ].includes(error.code);
  return error.status >= 500 && !rejectedBeforePersistence;
}
