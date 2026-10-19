import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';

export interface HistoricalInstrumentProfile {
  currency: string | null;
  ipoDate: string | null;
}

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
  getProfile(symbol: string): Promise<Result<HistoricalInstrumentProfile, ApiFailure>>;
  getHistory(window: HistoricalPriceWindow): Promise<Result<HistoricalClose[], ApiFailure>>;
}
