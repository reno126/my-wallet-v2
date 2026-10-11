import type { ApiEnvironmentInput } from './config/environment.js';

export interface ApiPluginOptions {
  environment: ApiEnvironmentInput;
}

declare module 'fastify' {
  interface FastifyInstance {
    apiEnvironment: ApiEnvironmentInput;
  }
}
