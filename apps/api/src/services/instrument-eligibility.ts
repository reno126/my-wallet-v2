import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';
import type { VerifiedInstrument } from './instrument-verifier.js';

interface StockClassification {
  exchange?: string | null | undefined;
  isEtf?: boolean | null | undefined;
  isFund?: boolean | null | undefined;
}

interface BuyInstrumentDetails extends StockClassification {
  symbol: string;
  name: string | null | undefined;
  quoteCurrency: string | null | undefined;
}

const unsupportedExchanges = new Set(['CRYPTO', 'FOREX', 'COMMODITY', 'INDEX']);

export function hasUnsupportedStockClassification(instrument: StockClassification): boolean {
  return (
    instrument.isEtf === true ||
    instrument.isFund === true ||
    unsupportedExchanges.has(instrument.exchange?.toUpperCase() ?? '')
  );
}

export function validateBuyInstrument(
  instrument: BuyInstrumentDetails,
): Result<VerifiedInstrument, ApiFailure> {
  if (!instrument.quoteCurrency) return { ok: false, error: { code: 'CURRENCY_UNAVAILABLE' } };
  if (instrument.quoteCurrency.toUpperCase() !== 'USD')
    return { ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } };
  if (
    hasUnsupportedStockClassification(instrument) ||
    instrument.isEtf !== false ||
    instrument.isFund !== false ||
    !instrument.exchange
  )
    return { ok: false, error: { code: 'UNSUPPORTED_INSTRUMENT' } };
  if (!instrument.name) return { ok: false, error: { code: 'PROVIDER_ERROR' } };
  return {
    ok: true,
    value: {
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.exchange,
      quoteCurrency: 'USD',
    },
  };
}
