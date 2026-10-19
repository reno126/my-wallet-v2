import { mapProviderFailure } from '../../http/provider-failure.ts';
import type { InstrumentVerifier } from '../../services/instrument-verifier.ts';
import type { createFmpClient } from './client.ts';
import { fmpProfileResponseSchema } from './instruments.ts';

const unsupportedExchanges = new Set(['CRYPTO', 'FOREX', 'COMMODITY', 'INDEX']);

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
      if (!result.ok) return { ok: false, error: mapProviderFailure(result.error) };
      const profile = result.value[0];
      if (!profile) return { ok: false, error: { code: 'NOT_FOUND' } };
      if (profile.symbol !== symbol) return { ok: false, error: { code: 'PROVIDER_ERROR' } };
      if (!profile.currency) return { ok: false, error: { code: 'CURRENCY_UNAVAILABLE' } };
      if (profile.currency.toUpperCase() !== 'USD')
        return { ok: false, error: { code: 'UNSUPPORTED_CURRENCY' } };
      if (
        profile.isEtf !== false ||
        profile.isFund !== false ||
        !profile.exchange ||
        unsupportedExchanges.has(profile.exchange.toUpperCase())
      )
        return { ok: false, error: { code: 'UNSUPPORTED_INSTRUMENT' } };
      if (!profile.companyName) return { ok: false, error: { code: 'PROVIDER_ERROR' } };
      return {
        ok: true,
        value: {
          symbol,
          name: profile.companyName,
          exchange: profile.exchange,
          quoteCurrency: 'USD',
        },
      };
    },
  };
}
