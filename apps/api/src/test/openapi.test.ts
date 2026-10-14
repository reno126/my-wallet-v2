import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';

import { apiErrorSchema, healthStatusSchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { createOpenApiValidator } from '../../test-support/openapi-contract.js';

describe('OpenAPI contract', () => {
  let apiServer: TestServer | undefined;

  afterEach(async () => {
    await apiServer?.close();
    apiServer = undefined;
  });

  it('serves Swagger UI with a static CSP and Helmet security headers', async () => {
    const server = createTestServer();
    apiServer = server;
    await server.ready();

    const documentationResponse = await server.inject({
      method: 'GET',
      url: '/documentation/',
    });

    expect(documentationResponse.statusCode).toBe(200);
    expect(documentationResponse.headers['content-type']).toContain('text/html');
    expect(documentationResponse.payload).toContain('id="swagger-ui"');
    expect(documentationResponse.payload).toContain('swagger-ui-bundle.js');
    expect(documentationResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(documentationResponse.headers['x-frame-options']).toBe('SAMEORIGIN');

    const contentSecurityPolicy = documentationResponse.headers['content-security-policy'];
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("style-src 'self'");
    expect(contentSecurityPolicy).not.toContain("'unsafe-inline'");
  });

  it('documents each health operation with unique IDs and validates successful responses', async () => {
    const server = createTestServer();
    apiServer = server;
    await server.ready();

    const {
      document: apiDocument,
      operationIds,
      assertResponse,
    } = await createOpenApiValidator(server);

    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(apiDocument.components?.schemas).toHaveProperty('WalletSummary');
    expect(apiDocument.components?.schemas).toHaveProperty('InstrumentSearchResponse');

    const healthResponse = await server.inject({ method: 'GET', url: '/api/health' });
    assertResponse('get', '/api/health', healthResponse);
    expect(healthResponse.statusCode).toBe(200);
  });

  it('documents and validates common error responses using the actual status code', async () => {
    const server = createTestServer();
    apiServer = server;
    server.register(failureRoute, { prefix: '/api' });
    await server.ready();

    const { assertResponse } = await createOpenApiValidator(server);

    const failureResponse = await server.inject({ method: 'GET', url: '/api/contract-failure' });

    assertResponse('get', '/api/contract-failure', failureResponse);
    expect(failureResponse.statusCode).toBe(500);
    expect(apiErrorSchema.parse(failureResponse.json()).error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('validates rate-limited responses and checks the emitted response headers', async () => {
    const server = createTestServer();
    apiServer = server;
    server.register(rateLimitRoute, { prefix: '/api' });
    await server.ready();

    const { document: apiDocument, assertResponse } = await createOpenApiValidator(server);

    const firstResponse = await server.inject({ method: 'GET', url: '/api/contract-rate-limit' });
    const limitedResponse = await server.inject({ method: 'GET', url: '/api/contract-rate-limit' });

    assertResponse('get', '/api/contract-rate-limit', limitedResponse);
    expect(firstResponse.statusCode).toBe(200);
    expect(limitedResponse.statusCode).toBe(429);
    expect(apiDocument.components?.responses?.['RateLimited']).toHaveProperty(
      'headers.retry-after',
    );
    expect(limitedResponse.headers['retry-after']).toBeDefined();
    expect(limitedResponse.headers['x-ratelimit-limit']).toBeDefined();
    expect(limitedResponse.headers['x-ratelimit-remaining']).toBeDefined();
    expect(limitedResponse.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('documents a Better Auth handler response through its OpenAPI operation', async () => {
    const server = createTestServer();
    apiServer = server;
    await server.ready();

    const { document: apiDocument, assertResponse } = await createOpenApiValidator(server);

    expect(apiDocument).toHaveProperty(
      'paths./auth/sign-up/email.post.responses.200.headers.set-cookie',
    );

    expect(apiDocument.paths?.['/auth/sign-up/email']?.post?.operationId).toBe('registerWithEmail');

    const sessionResponse = await server.inject({
      method: 'GET',
      url: '/api/auth/get-session',
    });

    assertResponse('get', '/api/auth/get-session', sessionResponse);
    expect(sessionResponse.statusCode).toBe(200);
  });
});

const failureRoute: FastifyPluginCallbackZod = (
  server,
  _pluginOptions,
  completePluginRegistration,
) => {
  server.get(
    '/contract-failure',
    {
      schema: {
        operationId: 'getContractFailure',
        summary: 'Exercise the documented common error response in contract tests',
        response: { 500: apiErrorSchema },
      },
    },
    () => {
      throw new Error('Expected contract-test failure');
    },
  );
  completePluginRegistration();
};

const rateLimitRoute: FastifyPluginCallbackZod = (
  server,
  _pluginOptions,
  completePluginRegistration,
) => {
  server.get(
    '/contract-rate-limit',
    {
      config: { rateLimit: { max: 1, timeWindow: 60_000 } },
      schema: {
        operationId: 'getContractRateLimit',
        summary: 'Exercise the documented rate-limit response in contract tests',
        response: { 200: healthStatusSchema, 429: apiErrorSchema },
      },
    },
    () => healthStatusSchema.parse({ status: 'ok' }),
  );
  completePluginRegistration();
};
