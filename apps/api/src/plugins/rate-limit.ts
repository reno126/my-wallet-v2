import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { apiErrorMessages } from '@my-wallets/contracts';

import type { ApiPluginOptions } from '../plugin-options.js';

const healthProbePaths = new Set(['/api/health', '/api/health/live', '/api/health/ready']);

const rateLimitPlugin: FastifyPluginAsync<ApiPluginOptions> = async (server, { environment }) => {
  await server.register(rateLimit, {
    global: true,
    max: environment.API_RATE_LIMIT_MAX,
    timeWindow: environment.API_RATE_LIMIT_TIME_WINDOW_MS,
    allowList: (request) => healthProbePaths.has(new URL(request.url, 'http://localhost').pathname),
    errorResponseBuilder: (request, context) => ({
      statusCode: context.statusCode,
      error: {
        code: 'RATE_LIMITED',
        message: apiErrorMessages.RATE_LIMITED,
        requestId: request.id,
      },
    }),
  });

  server.setNotFoundHandler({ preHandler: server.rateLimit() }, (request, reply) => {
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: apiErrorMessages.NOT_FOUND,
        requestId: request.id,
      },
    });
  });
};

export default fastifyPlugin(rateLimitPlugin, {
  name: 'api-rate-limit',
  fastify: '5.x',
  dependencies: ['api-cors', 'api-helmet'],
});
