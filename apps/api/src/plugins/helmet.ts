import helmet from '@fastify/helmet';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { ApiPluginOptions } from '../plugin-options.js';

const helmetPlugin: FastifyPluginAsync<ApiPluginOptions> = async (server, { environment }) => {
  await server.register(helmet, {
    global: true,
    hsts:
      environment.NODE_ENV === 'production' && environment.API_HTTPS_ENABLED
        ? { maxAge: 15_552_000, includeSubDomains: false, preload: false }
        : false,
  });
};

export default fastifyPlugin(helmetPlugin, {
  name: 'api-helmet',
  fastify: '5.x',
});
