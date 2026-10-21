import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { apiErrorSchema, providerQuotaStatusSchema } from '@my-wallets/contracts';

import { sendResult } from '../../../http/send-result.ts';

const marketDataRoutes: FastifyPluginCallbackZod = (server, _options, done) => {
  server.get(
    '/quota',
    {
      schema: {
        operationId: 'getMarketDataQuota',
        summary: 'Read the shared application provider request budget',
        description:
          'Counts tracked outbound reservations across all users, including failed calls and retries. It is not the provider account balance. Reading consumes no quota. Returns configuration availability, local quota date, reset timezone and next reset instant.',
        tags: ['Market data'],
        response: {
          200: providerQuotaStatusSchema,
          401: apiErrorSchema,
          429: apiErrorSchema,
          500: apiErrorSchema,
          503: apiErrorSchema,
        },
      },
    },
    async (request, reply) => sendResult(reply, await server.marketData.quotaStatus(), request.id),
  );
  done();
};

export default marketDataRoutes;
