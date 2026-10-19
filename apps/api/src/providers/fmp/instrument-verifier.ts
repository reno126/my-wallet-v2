import { mapProviderFailure } from '../../http/provider-failure.ts';
import { failure } from '../../result.ts';
import { validateBuyInstrument } from '../../services/instrument-eligibility.ts';
import type { InstrumentVerifier } from '../../services/instrument-verifier.ts';
import type { createFmpClient } from './client.ts';
import { fmpProfileResponseSchema } from './instruments.ts';

export function createFmpInstrumentVerifier(
  client: ReturnType<typeof createFmpClient>,
): InstrumentVerifier {
  return {
    async verify(symbol) {
      const result = await client.request({
        endpoint: 'profile',
        parameters: { symbol },
        responseSchema: fmpProfileResponseSchema,
      });
      if (!result.ok) return failure(mapProviderFailure(result.error));
      const profile = result.value[0];
      if (!profile) return failure({ code: 'NOT_FOUND' });
      if (profile.symbol !== symbol) return failure({ code: 'PROVIDER_ERROR' });
      return validateBuyInstrument({
        symbol,
        name: profile.companyName,
        quoteCurrency: profile.currency,
        exchange: profile.exchange,
        isEtf: profile.isEtf,
        isFund: profile.isFund,
      });
    },
  };
}
