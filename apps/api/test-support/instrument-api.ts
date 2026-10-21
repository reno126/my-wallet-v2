import Fastify from 'fastify';
import { onTestFinished } from 'vitest';

import { type ApiFixtureOptions, createApiFixture } from './api-fixture.ts';
import { createTestProviderBudget } from './provider-budget.ts';

export interface FakeProviderResponse {
  body?: unknown;
  rawJson?: string;
  status?: number;
  stall?: boolean | 'body';
}

export interface InstrumentApiFixtureOptions extends Omit<ApiFixtureOptions, 'fmp'> {
  quotaLimit?: number;
  configureQuota?: boolean;
}

export async function createInstrumentApiFixture(
  replies: readonly FakeProviderResponse[],
  options: InstrumentApiFixtureOptions = {},
) {
  const provider = Fastify({ logger: false, forceCloseConnections: true });
  const pendingReplies = [...replies];
  const requests: URL[] = [];
  const reservationsAtDispatch: number[] = [];
  const budget = createTestProviderBudget(options.quotaLimit ?? 100);

  provider.get('/stable/*', (request, reply) => {
    requests.push(new URL(request.url, 'http://127.0.0.1'));
    reservationsAtDispatch.push(budget.used());
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
  const fixture = await createApiFixture({
    environment: {
      FMP_API_KEY: 'test-only-provider-key',
      FMP_BASE_URL: `${providerAddress}/stable/`,
      ...options.environment,
    },
    authenticate: options.authenticate ?? true,
    ...(options.configureQuota === false ? {} : { fmp: { budget, timeoutMs: 500 } }),
  });
  return {
    ...fixture,
    used: budget.used,
    requests,
    reservationsAtDispatch,
  };
}
