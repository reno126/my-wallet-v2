import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, onTestFinished } from 'vitest';
import { z as zod } from 'zod';

import { createFmpClient } from './client.js';

const responseSchema = zod.array(zod.object({ symbol: zod.string() }));
const searchRequest = {
  endpoint: 'search-symbol',
  parameters: { query: 'AAPL' },
  responseSchema,
} satisfies Parameters<ReturnType<typeof createFmpClient>['request']>[0];

async function createFakeProvider(
  handler: (request: FastifyRequest, reply: FastifyReply) => unknown,
  { limit = 10, timeoutMs = 1_000 } = {},
) {
  const provider = Fastify({ logger: false, forceCloseConnections: true });
  const requests: URL[] = [];
  let used = 0;
  let usedAtDispatch = 0;

  provider.get('/stable/*', (request, reply) => {
    requests.push(new URL(request.url, 'http://127.0.0.1'));
    usedAtDispatch = used;
    return handler(request, reply);
  });

  onTestFinished(() => provider.close());
  const address = await provider.listen({ host: '127.0.0.1', port: 0 });
  const client = createFmpClient({
    environment: { FMP_API_KEY: 'test-only-fmp-key', FMP_BASE_URL: `${address}/stable/` },
    reserveRequest: () => {
      if (used >= limit) {
        return Promise.resolve(false);
      }
      used += 1;
      return Promise.resolve(true);
    },
    timeoutMs,
  });

  return { client, requests, used: () => used, usedAtDispatch: () => usedAtDispatch };
}

describe('when the FMP adapter calls a controlled HTTP provider', () => {
  it.each([
    'search-symbol',
    'search-name',
    'profile',
    'historical-price-eod/full',
    'quote',
  ] as const)(
    'should reserve one unit before dispatching %s and validate the response',
    async (endpoint) => {
      // Arrange
      const provider = await createFakeProvider(() => [
        { symbol: 'AAPL', extraProviderField: 'ignored' },
      ]);

      // Act
      const result = await provider.client.request({ ...searchRequest, endpoint });

      // Assert
      expect(result).toStrictEqual({ ok: true, value: [{ symbol: 'AAPL' }] });
      expect(provider.used()).toBe(1);
      expect(provider.usedAtDispatch()).toBe(1);
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.pathname).toBe(`/stable/${endpoint}`);
      expect(provider.requests[0]?.searchParams.get('apikey')).toBe('test-only-fmp-key');
    },
  );

  it('should encode query values as data without changing the endpoint or credentials', async () => {
    // Arrange
    const provider = await createFakeProvider(() => []);
    const query = 'A&B /?apikey=attacker# + Ł';

    // Act
    await provider.client.request({ ...searchRequest, parameters: { query } });

    // Assert
    expect(provider.requests[0]?.searchParams.get('query')).toBe(query);
    expect(provider.requests[0]?.searchParams.getAll('apikey')).toStrictEqual([
      'test-only-fmp-key',
    ]);
    expect(provider.requests[0]?.pathname).toBe('/stable/search-symbol');
    expect(provider.used()).toBe(1);
  });

  it.each([401, 403, 429, 500, 503])(
    'should charge a %s failure once without a hidden retry',
    async (status) => {
      // Arrange
      const provider = await createFakeProvider((_request, reply) =>
        reply.code(status).send({ message: 'private provider details' }),
      );

      // Act
      const result = await provider.client.request(searchRequest);

      // Assert
      expect(result).toStrictEqual({ ok: false, error: { code: 'HTTP_ERROR', status } });
      expect(provider.used()).toBe(1);
      expect(provider.requests).toHaveLength(1);
    },
  );

  it('should charge a failed attempt and its successful retry independently', async () => {
    // Arrange
    let attempts = 0;
    const provider = await createFakeProvider((_request, reply) => {
      attempts += 1;
      return attempts === 1 ? reply.code(503).send({}) : [{ symbol: 'AAPL' }];
    });

    // Act
    const first = await provider.client.request(searchRequest);
    const retry = await provider.client.request(searchRequest);

    // Assert
    expect(first).toStrictEqual({ ok: false, error: { code: 'HTTP_ERROR', status: 503 } });
    expect(retry).toStrictEqual({ ok: true, value: [{ symbol: 'AAPL' }] });
    expect(provider.used()).toBe(2);
    expect(provider.requests).toHaveLength(2);
    expect(provider.usedAtDispatch()).toBe(2);
  });

  it('should stop dispatching after the failed attempt exhausts the quota', async () => {
    // Arrange
    const provider = await createFakeProvider((_request, reply) => reply.code(503).send({}), {
      limit: 1,
    });

    // Act
    await provider.client.request(searchRequest);
    const retry = await provider.client.request(searchRequest);

    // Assert
    expect(retry).toStrictEqual({ ok: false, error: { code: 'QUOTA_EXHAUSTED' } });
    expect(provider.used()).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  it('should refuse redirects so they cannot forward credentials or cause unaccounted requests', async () => {
    // Arrange
    const provider = await createFakeProvider((_request, reply) =>
      reply.redirect('/stable/profile'),
    );

    // Act
    const result = await provider.client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'HTTP_ERROR', status: 302 } });
    expect(provider.used()).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  it.each([
    ['invalid JSON', '{broken'],
    ['an incompatible schema', { symbol: 123 }],
  ])('should charge and sanitize %s', async (_description, body) => {
    // Arrange
    const provider = await createFakeProvider((_request, reply) => reply.send(body));

    // Act
    const result = await provider.client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'INVALID_RESPONSE' } });
    expect(provider.used()).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  it('should reject a provider error envelope even when the supplied schema accepts it', async () => {
    // Arrange
    const provider = await createFakeProvider(() => ({
      'Error Message': 'apikey=test-only-fmp-key',
    }));

    // Act
    const result = await provider.client.request({
      ...searchRequest,
      responseSchema: zod.unknown(),
    });

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'PROVIDER_ERROR' } });
    expect(provider.used()).toBe(1);
  });

  it('should keep the charge when the provider sends headers but stalls the body', async () => {
    // Arrange
    const provider = await createFakeProvider(
      (_request, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write('[');
      },
      { timeoutMs: 500 },
    );

    // Act
    const result = await provider.client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'TIMEOUT' } });
    expect(provider.used()).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });

  it('should keep the charge when the provider never sends response headers', async () => {
    // Arrange
    const provider = await createFakeProvider(
      (_request, reply) => {
        reply.hijack();
      },
      { timeoutMs: 500 },
    );

    // Act
    const result = await provider.client.request(searchRequest);

    // Assert
    expect(result).toStrictEqual({ ok: false, error: { code: 'TIMEOUT' } });
    expect(provider.used()).toBe(1);
    expect(provider.requests).toHaveLength(1);
  });
});
