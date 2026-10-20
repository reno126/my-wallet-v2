import type { VerifiedInstrument } from '../domain/instrument.ts';
import type { ApiFailure } from '../http/api-failure.js';
import type { Result } from '../result.js';

export interface InstrumentVerifier {
  verify(symbol: string): Promise<Result<VerifiedInstrument, ApiFailure>>;
}
