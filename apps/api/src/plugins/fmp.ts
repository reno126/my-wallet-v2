import type { FastifyPluginCallback } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { createMarketCalendar } from '../domain/market-calendar.ts';
import type { ApiPluginOptions } from '../plugin-options.js';
import { createFmpClient } from '../providers/fmp/client.ts';
import { createFmpCurrentPriceProvider } from '../providers/fmp/current-price-provider.ts';
import { createFmpHistoricalPriceProvider } from '../providers/fmp/historical-price-provider.ts';
import { createFmpInstrumentVerifier } from '../providers/fmp/instrument-verifier.ts';
import { createPriceCacheRepository } from '../repositories/price-cache.ts';
import { createProviderQuotaRepository } from '../repositories/provider-quota.ts';
import { createRefreshWorkRepository } from '../repositories/refresh-work.ts';
import { createHistoricalPriceService } from '../services/historical-price.ts';
import { createInstrumentSearchService } from '../services/instrument-search.ts';
import { createPriceRefreshRecovery } from '../services/price-refresh-recovery.ts';
import { createPriceRefreshScheduler } from '../services/price-refresh-scheduler.ts';

declare module 'fastify' {
  interface FastifyInstance {
    instrumentSearch: ReturnType<typeof createInstrumentSearchService>;
    historicalPrices: ReturnType<typeof createHistoricalPriceService>;
    instrumentVerifier: ReturnType<typeof createFmpInstrumentVerifier>;
    priceRefresh: ReturnType<typeof createPriceRefreshScheduler>;
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
  const work = createRefreshWorkRepository(server.prisma);
  const scheduler = createPriceRefreshScheduler({
    work,
    cache: createPriceCacheRepository(server.prisma),
    provider: createFmpCurrentPriceProvider(client, createMarketCalendar('America/New_York')),
    calendar: createMarketCalendar(options.environment.FMP_QUOTA_TIMEZONE),
    concurrency: options.environment.FMP_REFRESH_CONCURRENCY,
    onError: () =>
      server.log.error('Background price refresh failed; persisted work may require recovery.'),
  });
  server.decorate('priceRefresh', scheduler);
  const recovery = createPriceRefreshRecovery({
    work,
    quota,
    scheduler,
    onError: () =>
      server.log.error('Price refresh recovery failed; persisted work remains available.'),
  });
  server.addHook('onReady', async () => {
    if (options.recoverRefreshWork !== false && options.environment.FMP_API_KEY) {
      await recovery.start();
    }
  });
  async function stopRefreshes() {
    await Promise.all([recovery.stop(), scheduler.stop()]);
  }
  server.addHook('preClose', stopRefreshes);
  server.addHook('onClose', stopRefreshes);
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
