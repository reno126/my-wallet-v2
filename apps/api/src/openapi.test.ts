import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { OpenAPIBackend } from 'openapi-backend';
import { afterEach, describe, expect, it } from 'vitest';

import { apiErrorSchema, healthStatusSchema } from '@my-wallets/contracts';

import { apiEnvironmentSchema } from './config/environment.js';
import { addRateLimitContract } from './openapi-document.js';
import { buildServer } from './server.js';

describe('OpenAPI contract', () => {
  let apiServer: ReturnType<typeof buildServer> | undefined;

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

    const apiDocument = addRateLimitContract(server.swagger());
    const contractApi = new OpenAPIBackend({
      definition: apiDocument,
      strict: true,
      apiRoot: '/api',
    });
    await contractApi.init();
    const operationIds = contractApi.router
      .getOperations()
      .flatMap((operation) => (operation.operationId ? [operation.operationId] : []));

    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(apiDocument.components?.schemas).toHaveProperty('WalletSummary');
    expect(apiDocument.components?.schemas).toHaveProperty('InstrumentSearchResponse');

    const healthResponse = await server.inject({ method: 'GET', url: '/api/health' });
    validateResponseAgainstContract(contractApi, '/api/health', healthResponse);
    expect(healthResponse.statusCode).toBe(200);
  });

  it('documents and validates common error responses using the actual status code', async () => {
    const server = createTestServer();
    apiServer = server;
    server.register(failureRoute, { prefix: '/api' });
    await server.ready();

    const apiDocument = addRateLimitContract(server.swagger());
    const contractApi = new OpenAPIBackend({
      definition: apiDocument,
      strict: true,
      apiRoot: '/api',
    });
    await contractApi.init();

    const failureResponse = await server.inject({ method: 'GET', url: '/api/contract-failure' });

    validateResponseAgainstContract(contractApi, '/api/contract-failure', failureResponse);
    expect(failureResponse.statusCode).toBe(500);
    expect(apiErrorSchema.parse(failureResponse.json()).error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('validates rate-limited responses and checks the emitted response headers', async () => {
    const server = createTestServer();
    apiServer = server;
    server.register(rateLimitRoute, { prefix: '/api' });
    await server.ready();

    const apiDocument = addRateLimitContract(server.swagger());
    const contractApi = new OpenAPIBackend({
      definition: apiDocument,
      strict: true,
      apiRoot: '/api',
    });
    await contractApi.init();

    const firstResponse = await server.inject({ method: 'GET', url: '/api/contract-rate-limit' });
    const limitedResponse = await server.inject({ method: 'GET', url: '/api/contract-rate-limit' });

    validateResponseAgainstContract(contractApi, '/api/contract-rate-limit', limitedResponse);
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

    const apiDocument = addRateLimitContract(server.swagger());
    const contractApi = new OpenAPIBackend({
      definition: apiDocument,
      strict: true,
      apiRoot: '/api',
    });
    await contractApi.init();

    expect(apiDocument).toHaveProperty(
      'paths./auth/sign-up/email.post.responses.200.headers.set-cookie',
    );

    expect(
      contractApi.matchOperation({
        method: 'post',
        path: '/api/auth/sign-up/email',
        headers: {},
      })?.operationId,
    ).toBe('registerWithEmail');

    const sessionResponse = await server.inject({
      method: 'GET',
      url: '/api/auth/get-session',
    });

    validateResponseAgainstContract(contractApi, '/api/auth/get-session', sessionResponse);
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

function createTestServer() {
  return buildServer({
    environment: apiEnvironmentSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://wallet_local:wallet_local_only@127.0.0.1:5432/wallet_test?schema=public',
    }),
    logger: false,
  });
}

function validateResponseAgainstContract(
  contractApi: OpenAPIBackend,
  requestPath: string,
  response: Awaited<ReturnType<ReturnType<typeof buildServer>['inject']>>,
) {
  const matchedOperation = contractApi.matchOperation({
    method: 'get',
    path: requestPath,
    headers: {},
  });

  expect(matchedOperation?.operationId).toBeDefined();
  const operationId = matchedOperation?.operationId;
  expect(operationId).toBeDefined();

  const documentedResponse = matchedOperation?.responses?.[String(response.statusCode)];
  expect(documentedResponse).toBeDefined();

  const responseBody: unknown = response.json();
  const validationResult = contractApi.validateResponse(
    responseBody,
    operationId ?? '',
    response.statusCode,
  );
  expect(validationResult.valid).toBe(true);

  const responseContent =
    documentedResponse && 'content' in documentedResponse ? documentedResponse.content : undefined;
  const documentedMediaTypes = Object.keys(responseContent ?? {});
  const responseMediaType = response.headers['content-type']?.split(';')[0];
  expect(documentedMediaTypes).toContain(responseMediaType);

  const responseHeaderValidation = contractApi.validateResponseHeaders(
    response.headers,
    operationId ?? '',
    { statusCode: response.statusCode },
  );
  expect(responseHeaderValidation.valid).toBe(true);
}
