import type { VerifiedInstrument } from '../domain/instrument.ts';
import { validateUsdCurrency } from '../domain/usd-currency.ts';
import type { ApiFailure } from '../http/api-failure.js';
import { failure, type Result, success } from '../result.ts';

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
  const currency = validateUsdCurrency(instrument.quoteCurrency);
  if (!currency.ok) {
    return currency;
  }
  if (
    hasUnsupportedStockClassification(instrument) ||
    instrument.isEtf !== false ||
    instrument.isFund !== false ||
    !instrument.exchange
  ) {
    return failure({ code: 'UNSUPPORTED_INSTRUMENT' });
  }
  if (!instrument.name) {
    return failure({ code: 'PROVIDER_ERROR' });
  }
  return success({
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    quoteCurrency: currency.value,
  });
}
