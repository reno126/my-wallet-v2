import type { ApiEnvironmentInput } from './config/environment.js';
import type { FmpDependencies } from './providers/fmp/client.js';

export interface ApiPluginOptions {
  environment: ApiEnvironmentInput;
  fmp?: FmpDependencies;
}

declare module 'fastify' {
  interface FastifyInstance {
    apiEnvironment: ApiEnvironmentInput;
  }
}
