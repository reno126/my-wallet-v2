import Fastify from 'fastify';
import { expect, onTestFinished } from 'vitest';

import { createAuthenticatedUser } from './authenticated-user.js';
import { createTestServer } from './create-test-server.js';
import { createOpenApiValidator } from './openapi-contract.js';

export interface FakeProviderResponse {
  body?: unknown;
  rawJson?: string;
  status?: number;
  stall?: boolean | 'body';
}

export interface InstrumentApiFixtureOptions {
  quotaLimit?: number;
  configureQuota?: boolean;
  authenticate?: boolean;
  environment?: Record<string, string>;
}

export async function createInstrumentApiFixture(
  replies: readonly FakeProviderResponse[],
  options: InstrumentApiFixtureOptions = {},
) {
  const provider = Fastify({ logger: false, forceCloseConnections: true });
  const pendingReplies = [...replies];
  const requests: URL[] = [];
  const reservationsAtDispatch: number[] = [];
  let used = 0;

  provider.get('/stable/*', (request, reply) => {
    requests.push(new URL(request.url, 'http://127.0.0.1'));
    reservationsAtDispatch.push(used);
    const next = pendingReplies.shift();
    if (!next) {
      return reply.code(500).send({});
    }
    if (next.stall) {
      reply.hijack();
      if (next.stall === 'body') {
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write('[');
      }
      return;
    }
    reply.code(next.status ?? 200);
    return next.rawJson === undefined
      ? reply.send(next.body ?? [])
      : reply.type('application/json').send(next.rawJson);
  });
  onTestFinished(() => provider.close());
  const providerAddress = await provider.listen({ host: '127.0.0.1', port: 0 });
  const server = createTestServer(
    {
      FMP_API_KEY: 'test-only-provider-key',
      FMP_BASE_URL: `${providerAddress}/stable/`,
      ...options.environment,
    },
    options.configureQuota === false
      ? {}
      : {
          fmp: {
            timeoutMs: 500,
            reserveRequest: () => {
              if (used >= (options.quotaLimit ?? 100)) {
                return Promise.resolve(false);
              }
              used += 1;
              return Promise.resolve(true);
            },
          },
        },
  );
  const registeredEmails: string[] = [];
  const registeredSymbols: string[] = [];
  onTestFinished(async () => {
    try {
      if (server.hasDecorator('prisma') && registeredEmails.length > 0) {
        await server.prisma.user.deleteMany({ where: { email: { in: registeredEmails } } });
      }
      if (server.hasDecorator('prisma') && registeredSymbols.length > 0) {
        await server.prisma.instrument.deleteMany({ where: { symbol: { in: registeredSymbols } } });
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
    owner,
    contract,
    registeredEmails,
    registeredSymbols,
    used: () => used,
    requests,
    reservationsAtDispatch,
    async get(url: string) {
      const response = await server.inject({ method: 'GET', url, headers: owner?.headers ?? {} });
      contract.assertResponse('get', url.split('?')[0] ?? url, response);
      expect(response.headers['cache-control']).toBe('no-store');
      return response;
    },
  };
}
