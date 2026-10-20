import { apiEnvironment } from './config/environment.js';
import { registerShutdown } from './lifecycle/shutdown.ts';
import { buildServer } from './server.js';

const server = buildServer();
const unregisterShutdown = registerShutdown({
  signals: process,
  close: () => server.close(),
  onError: () => {
    server.log.error('Unable to shut down API server cleanly');
    process.exitCode = 1;
  },
});
server.addHook('onClose', (_instance, done) => {
  unregisterShutdown();
  done();
});

try {
  await server.listen({ host: apiEnvironment.API_HOST, port: apiEnvironment.PORT });
} catch (error: unknown) {
  server.log.error({ err: error }, 'Unable to start API server');
  process.exitCode = 1;
  await server.close();
}
