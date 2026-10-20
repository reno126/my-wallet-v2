import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import type { ApiFailure } from '../http/api-failure.ts';
import type { Result } from '../result.ts';

export interface RefreshFailure {
  code: ApiFailure['code'];
  retryable: boolean;
}

export interface CurrentPriceProvider {
  getQuote(symbol: string): Promise<Result<Omit<PriceSnapshot, 'symbol'>, RefreshFailure>>;
}
