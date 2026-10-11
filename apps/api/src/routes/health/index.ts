import type { FastifyPluginCallback } from 'fastify';

const healthRoutes: FastifyPluginCallback = (
  server,
  _pluginOptions,
  completePluginRegistration,
) => {
  server.get('/', () => ({ status: 'ok' }));
  server.get('/live', () => ({ status: 'ok' }));
  server.get('/ready', () => ({ status: 'ok' }));
  completePluginRegistration();
};

export default healthRoutes;
