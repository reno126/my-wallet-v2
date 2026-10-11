import { apiEnvironment } from './config/environment.js';
import { buildServer } from './server.js';

const server = buildServer();

try {
  await server.listen({ host: apiEnvironment.API_HOST, port: apiEnvironment.PORT });
} catch (error: unknown) {
  server.log.error({ err: error }, 'Unable to start API server');
  process.exitCode = 1;
  await server.close();
}
