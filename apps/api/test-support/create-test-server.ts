import { apiEnvironmentSchema } from '../src/config/environment.js';
import { buildServer, type BuildServerOptions } from '../src/server.js';

export type TestServer = ReturnType<typeof buildServer>;

const baseTestEnvironment = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'production-mode-test-fixture-secret-with-enough-length',
  BETTER_AUTH_URL: 'https://api.test.example',
  WEB_ORIGIN: 'https://wallet.test.example',
  DATABASE_URL:
    'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_test?schema=public',
};

export function createTestServer(
  environmentOverrides: Record<string, string> = {},
  options: Pick<BuildServerOptions, 'fmp'> = {},
): TestServer {
  return buildServer({
    ...options,
    environment: apiEnvironmentSchema.parse({ ...baseTestEnvironment, ...environmentOverrides }),
    logger: false,
  });
}
