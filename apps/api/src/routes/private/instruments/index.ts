import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import {
  apiErrorSchema,
  instrumentSearchQuerySchema,
  instrumentSearchResponseSchema,
} from '@my-wallets/contracts';

import { sendResult } from '../../../http/send-result.ts';

const instrumentRoutes: FastifyPluginCallbackZod = (
  server,
  _options,
  completePluginRegistration,
) => {
  server.get(
    '/search',
    {
      exposeHeadRoute: false,
      schema: {
        operationId: 'searchInstruments',
        summary: 'Search by stock symbol or company name',
        description:
          'Returns up to 10 USD candidates and explicit reasons for excluded results. A profile is requested only when name or currency is missing. Live dispatch requires a configured shared quota reservation store.',
        tags: ['Instruments'],
        querystring: instrumentSearchQuerySchema,
        response: {
          200: instrumentSearchResponseSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          429: apiErrorSchema,
          500: apiErrorSchema,
          502: apiErrorSchema,
          503: apiErrorSchema,
          504: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await server.instrumentSearch.search(request.query);
      return sendResult(reply, result, request.id);
    },
  );

  completePluginRegistration();
};

export default instrumentRoutes;
