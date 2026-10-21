import { expect, onTestFinished } from 'vitest';

import type { FmpPluginDependencies } from '../src/plugin-options.ts';
import { createAuthenticatedUser } from './authenticated-user.ts';
import { createTestServer } from './create-test-server.ts';
import { createOpenApiValidator } from './openapi-contract.ts';

export interface ApiFixtureOptions {
  fmp?: FmpPluginDependencies;
  authenticate?: boolean;
  environment?: Record<string, string>;
}

export async function createApiFixture(options: ApiFixtureOptions = {}) {
  const server = createTestServer(
    options.environment ?? {},
    options.fmp === undefined ? {} : { fmp: options.fmp },
  );
  const registeredEmails: string[] = [];
  const registeredSymbols: string[] = [];
  const registeredProviders: string[] = [];
  onTestFinished(async () => {
    try {
      if (server.hasDecorator('priceRefresh')) {
        await server.priceRefresh.stop();
      }
      if (server.hasDecorator('prisma')) {
        if (registeredEmails.length > 0) {
          await server.prisma.user.deleteMany({ where: { email: { in: registeredEmails } } });
        }
        if (registeredSymbols.length > 0) {
          await server.prisma.refreshWork.deleteMany({
            where: { symbol: { in: registeredSymbols } },
          });
          await server.prisma.priceSnapshot.deleteMany({
            where: { symbol: { in: registeredSymbols } },
          });
          await server.prisma.instrument.deleteMany({
            where: { symbol: { in: registeredSymbols } },
          });
        }
        if (registeredProviders.length > 0) {
          await server.prisma.providerQuotaDay.deleteMany({
            where: { provider: { in: registeredProviders } },
          });
          await server.prisma.providerBudget.deleteMany({
            where: { provider: { in: registeredProviders } },
          });
        }
      }
    } finally {
      await server.close();
    }
  });
  await server.ready();
  const contract = await createOpenApiValidator(server);
  const owner =
    options.authenticate === false
      ? undefined
      : await createAuthenticatedUser(server, registeredEmails);
  return {
    server,
    contract,
    owner,
    registeredEmails,
    registeredSymbols,
    registeredProviders,
    async get(url: string) {
      const response = await server.inject({ method: 'GET', url, headers: owner?.headers ?? {} });
      contract.assertResponse('get', url.split('?')[0] ?? url, response);
      expect(response.headers['cache-control']).toBe('no-store');
      return response;
    },
  };
}

export type ApiFixture = Awaited<ReturnType<typeof createApiFixture>>;
