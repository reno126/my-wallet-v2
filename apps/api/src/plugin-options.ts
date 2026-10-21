import type { ApiEnvironmentInput } from './config/environment.js';
import type { FmpDependencies } from './providers/fmp/client.js';
import type { ProviderRequestBudget } from './repositories/provider-quota.ts';

export interface FmpPluginDependencies extends Omit<FmpDependencies, 'reserveRequest'> {
  budget: ProviderRequestBudget;
}

export interface ApiPluginOptions {
  environment: ApiEnvironmentInput;
  fmp?: FmpPluginDependencies;
  recoverRefreshWork?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    apiEnvironment: ApiEnvironmentInput;
  }
}
