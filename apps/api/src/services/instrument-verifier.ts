import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';

export interface VerifiedInstrument {
  symbol: string;
  name: string;
  exchange: string;
  quoteCurrency: 'USD';
}

export interface InstrumentVerifier {
  verify(symbol: string): Promise<Result<VerifiedInstrument, ApiFailure>>;
}
