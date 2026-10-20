import type { FastifyPluginCallback } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { ApiPluginOptions } from '../plugin-options.js';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createFmpHistoricalPriceProvider } from '../providers/fmp/historical-price-provider.ts';
import { createFmpInstrumentVerifier } from '../providers/fmp/instrument-verifier.ts';
import { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { createHistoricalPriceService } from '../services/historical-price.ts';
import { createInstrumentSearchService } from '../services/instrument-search.ts';

declare module 'fastify' {
  interface FastifyInstance {
    instrumentSearch: ReturnType<typeof createInstrumentSearchService>;
    historicalPrices: ReturnType<typeof createHistoricalPriceService>;
    instrumentVerifier: ReturnType<typeof createFmpInstrumentVerifier>;
  }
}

const fmpPlugin: FastifyPluginCallback<ApiPluginOptions> = (
  server,
  options,
  completePluginRegistration,
) => {
  const quota = createProviderQuotaRepository(server.prisma, {
    dailyLimit: options.environment.FMP_DAILY_REQUEST_LIMIT,
    timeZone: options.environment.FMP_QUOTA_TIMEZONE,
  });
  const client = createFmpClient({
    environment: options.environment,
    ...(options.fmp ?? { reserveRequest: quota.reserveRequest }),
  });

  server.decorate('instrumentSearch', createInstrumentSearchService(client));
  server.decorate('instrumentVerifier', createFmpInstrumentVerifier(client));
  server.decorate(
    'historicalPrices',
    createHistoricalPriceService(createFmpHistoricalPriceProvider(client)),
  );
  completePluginRegistration();
};

export default fastifyPlugin(fmpPlugin, {
  name: 'api-fmp',
  fastify: '5.x',
  dependencies: ['api-prisma'],
});
