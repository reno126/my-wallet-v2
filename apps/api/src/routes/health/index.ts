import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { apiErrorSchema, healthStatusSchema } from '@my-wallets/contracts';

const healthResponse = healthStatusSchema.parse({ status: 'ok' });

const healthResponseSchemas = {
  200: healthStatusSchema,
  500: apiErrorSchema,
};

const healthRoutes: FastifyPluginCallbackZod = (
  server,
  _pluginOptions,
  completePluginRegistration,
) => {
  server.get(
    '/',
    {
      schema: {
        operationId: 'getHealthStatus',
        summary: 'Check API health',
        tags: ['Health'],
        response: healthResponseSchemas,
      },
    },
    () => healthResponse,
  );
  server.get(
    '/live',
    {
      schema: {
        operationId: 'getLivenessStatus',
        summary: 'Check API liveness',
        tags: ['Health'],
        response: healthResponseSchemas,
      },
    },
    () => healthResponse,
  );
  server.get(
    '/ready',
    {
      schema: {
        operationId: 'getReadinessStatus',
        summary: 'Check API readiness',
        tags: ['Health'],
        response: healthResponseSchemas,
      },
    },
    () => healthResponse,
  );
  completePluginRegistration();
};

export default healthRoutes;
