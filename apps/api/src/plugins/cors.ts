import cors from '@fastify/cors';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { ApiPluginOptions } from '../plugin-options.js';

const corsPlugin: FastifyPluginAsync<ApiPluginOptions> = async (server, { environment }) => {
  await server.register(cors, {
    origin: environment.CORS_ALLOWED_ORIGINS,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
    exposedHeaders: [
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
    credentials: true,
  });
};

export default fastifyPlugin(corsPlugin, {
  name: 'api-cors',
  fastify: '5.x',
  dependencies: ['api-helmet'],
});
