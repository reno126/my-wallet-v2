import { failure, type Result, success } from '../result.ts';

export interface UsdCurrencyFailure {
  code: 'CURRENCY_UNAVAILABLE' | 'UNSUPPORTED_CURRENCY';
}

export function validateUsdCurrency(
  currency: string | null | undefined,
): Result<'USD', UsdCurrencyFailure> {
  if (!currency) {
    return failure({ code: 'CURRENCY_UNAVAILABLE' });
  }
  if (currency.toUpperCase() !== 'USD') {
    return failure({ code: 'UNSUPPORTED_CURRENCY' });
  }
  return success('USD');
}
