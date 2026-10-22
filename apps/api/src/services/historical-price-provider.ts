import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';

export interface HistoricalClose {
  date: string;
  close: string;
}

export interface HistoricalPriceWindow {
  symbol: string;
  from: string;
  to: string;
  expectedCurrency: string;
}

export interface HistoricalPriceProvider {
  getHistory(window: HistoricalPriceWindow): Promise<Result<HistoricalClose[], ApiFailure>>;
}
