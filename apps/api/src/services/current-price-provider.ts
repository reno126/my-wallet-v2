import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import type { UsdCurrencyFailure } from '../domain/usd-currency.ts';
import type { Result } from '../result.ts';

export type RefreshFailure =
  | { code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT'; retryable: boolean }
  | {
      code:
        | UsdCurrencyFailure['code']
        | 'CURRENCY_MISMATCH'
        | 'PRICE_NOT_AVAILABLE'
        | 'PROVIDER_UNAVAILABLE'
        | 'PROVIDER_PAYMENT_REQUIRED'
        | 'PROVIDER_QUOTA_EXHAUSTED';
      retryable: false;
    };

export interface CurrentPriceProvider {
  getQuote(symbol: string): Promise<Result<Omit<PriceSnapshot, 'symbol'>, RefreshFailure>>;
}
