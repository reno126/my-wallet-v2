import type { FastifyPluginCallback } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { ApiPluginOptions } from '../plugin-options.js';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createFmpHistoricalPriceProvider } from '../providers/fmp/historical-price-provider.ts';
import { createHistoricalPriceService } from '../services/historical-price.ts';
import { createInstrumentSearchService } from '../services/instrument-search.ts';

declare module 'fastify' {
  interface FastifyInstance {
    instrumentSearch: ReturnType<typeof createInstrumentSearchService>;
    historicalPrices: ReturnType<typeof createHistoricalPriceService>;
  }
}

const fmpPlugin: FastifyPluginCallback<ApiPluginOptions> = (
  server,
  options,
  completePluginRegistration,
) => {
  const client = createFmpClient({
    environment: options.environment,
    ...(options.fmp ?? {
      // Shared durable reservations arrive in 7A; never dispatch against an untracked budget.
      reserveRequest: () =>
        Promise.reject(new Error('Shared provider request budget is not configured.')),
    }),
  });

  server.decorate('instrumentSearch', createInstrumentSearchService(client));
  server.decorate(
    'historicalPrices',
    createHistoricalPriceService(createFmpHistoricalPriceProvider(client)),
  );
  completePluginRegistration();
};

export default fastifyPlugin(fmpPlugin, { name: 'api-fmp', fastify: '5.x' });
