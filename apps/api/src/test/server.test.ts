import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ApiErrorInput, apiErrorSchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { sendResult } from '../http/send-result.js';

describe('API server security boundary', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('reuses its connected Prisma client and releases the connection pool on close', async () => {
    const testServer = createTestServer();
    server = testServer;

    await testServer.ready();
    const queryResult = await testServer.prisma.$queryRaw<Array<{ database: string }>>`
      SELECT current_database() AS database
    `;
    const firstClient = testServer.prisma;
    const disconnect = vi.spyOn(firstClient, '$disconnect');

    await testServer.inject({ method: 'GET', url: '/api/health' });

    expect(queryResult).toStrictEqual([{ database: 'wallet_test' }]);
    expect(testServer.prisma).toBe(firstClient);

    await testServer.close();

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('loads health routes under the shared API prefix and applies Helmet headers', async () => {
    const testServer = createTestServer();
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['strict-transport-security']).toBeUndefined();

    const unprefixedResponse = await testServer.inject({ method: 'GET', url: '/health' });

    expect(unprefixedResponse.statusCode).toBe(404);
  });

  it('applies Helmet headers to expected and unexpected error responses', async () => {
    const testServer = createTestServer();
    server = testServer;
    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/failure', (request, reply) =>
        sendResult(reply, { ok: false, error: { code: 'NOT_FOUND' } }, request.id),
      );
      routeServer.get('/unexpected', () => {
        throw new Error('database connection string must remain private');
      });
      routeServer.get('/unexpected-client-status', () => {
        throw Object.assign(new Error('private application failure'), { statusCode: 400 });
      });
      completePluginRegistration();
    });

    const expectedFailureResponse = await testServer.inject({ method: 'GET', url: '/failure' });
    const unexpectedFailureResponse = await testServer.inject({
      method: 'GET',
      url: '/unexpected',
    });
    const unexpectedClientStatusResponse = await testServer.inject({
      method: 'GET',
      url: '/unexpected-client-status',
    });

    expect(expectedFailureResponse.statusCode).toBe(404);
    expect(parseApiErrorResponse(expectedFailureResponse.payload).error.code).toBe('NOT_FOUND');
    expect(expectedFailureResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(unexpectedFailureResponse.statusCode).toBe(500);
    expect(parseApiErrorResponse(unexpectedFailureResponse.payload).error.code).toBe(
      'INTERNAL_SERVER_ERROR',
    );
    expect(unexpectedFailureResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(unexpectedClientStatusResponse.statusCode).toBe(500);
    expect(unexpectedClientStatusResponse.payload).not.toContain('private application failure');
  });

  it('applies Helmet headers to the not-found response', async () => {
    const testServer = createTestServer();
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/unknown' });

    expect(response.statusCode).toBe(404);
    expect(parseApiErrorResponse(response.payload).error.code).toBe('NOT_FOUND');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('enables HSTS only when production HTTPS is explicitly configured', async () => {
    const testServer = createTestServer({ NODE_ENV: 'production', API_HTTPS_ENABLED: 'true' });
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('leaves HSTS disabled for production requests without an HTTPS ingress', async () => {
    const testServer = createTestServer({ NODE_ENV: 'production' });
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('enables credentialed CORS for configured exact origins only', async () => {
    const testServer = createTestServer({
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://wallet.example',
    });
    server = testServer;

    const allowedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    const rejectedResponse = await testServer.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://untrusted.example' },
    });

    expect(allowedResponse.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowedResponse.headers['access-control-allow-credentials']).toBe('true');
    expect(rejectedResponse.headers['access-control-allow-origin']).toBeUndefined();

    const preflightResponse = await testServer.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'https://wallet.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });

    expect(preflightResponse.statusCode).toBe(204);
    expect(preflightResponse.headers['access-control-allow-origin']).toBe('https://wallet.example');
    expect(preflightResponse.headers['access-control-allow-credentials']).toBe('true');
    expect(preflightResponse.headers['x-content-type-options']).toBe('nosniff');
  });

  it('limits API and unknown-path requests while exempting health probes', async () => {
    const testServer = createTestServer({
      API_RATE_LIMIT_MAX: '2',
      API_RATE_LIMIT_TIME_WINDOW_MS: '60000',
    });
    server = testServer;
    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/limited', () => ({ status: 'ok' }));
      completePluginRegistration();
    });

    const firstApiResponse = await testServer.inject({ method: 'GET', url: '/limited' });
    const secondApiResponse = await testServer.inject({ method: 'GET', url: '/limited' });
    const limitedApiResponse = await testServer.inject({ method: 'GET', url: '/limited' });
    const healthResponses = await Promise.all([
      testServer.inject({ method: 'GET', url: '/api/health' }),
      testServer.inject({ method: 'GET', url: '/api/health/ready' }),
      testServer.inject({ method: 'GET', url: '/api/health/live' }),
    ]);

    expect(firstApiResponse.statusCode).toBe(200);
    expect(secondApiResponse.statusCode).toBe(200);
    expect(limitedApiResponse.statusCode).toBe(429);
    expect(parseApiErrorResponse(limitedApiResponse.payload).error.code).toBe('RATE_LIMITED');
    expect(limitedApiResponse.headers['retry-after']).toBeDefined();
    expect(healthResponses.every((healthResponse) => healthResponse.statusCode === 200)).toBe(true);
  });

  it('rate limits repeated requests to an unknown API path', async () => {
    const testServer = createTestServer({
      API_RATE_LIMIT_MAX: '2',
      API_RATE_LIMIT_TIME_WINDOW_MS: '60000',
    });
    server = testServer;

    const firstNotFoundResponse = await testServer.inject({ method: 'GET', url: '/unknown' });
    const secondNotFoundResponse = await testServer.inject({ method: 'GET', url: '/unknown' });
    const limitedNotFoundResponse = await testServer.inject({ method: 'GET', url: '/unknown' });

    expect(firstNotFoundResponse.statusCode).toBe(404);
    expect(secondNotFoundResponse.statusCode).toBe(404);
    expect(limitedNotFoundResponse.statusCode).toBe(429);
    expect(parseApiErrorResponse(limitedNotFoundResponse.payload).error.code).toBe('RATE_LIMITED');
    expect(limitedNotFoundResponse.headers['retry-after']).toBeDefined();
  });

  it('does not trust forwarded client IP headers without a configured proxy range', async () => {
    const testServer = createTestServer({
      API_RATE_LIMIT_MAX: '1',
      API_RATE_LIMIT_TIME_WINDOW_MS: '60000',
    });
    server = testServer;
    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/limited', () => ({ status: 'ok' }));
      completePluginRegistration();
    });

    const firstResponse = await testServer.inject({
      method: 'GET',
      url: '/limited',
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    const spoofedIpResponse = await testServer.inject({
      method: 'GET',
      url: '/limited',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(spoofedIpResponse.statusCode).toBe(429);
  });

  it('uses forwarded client IP headers only when the immediate proxy is trusted', async () => {
    const testServer = createTestServer({
      API_TRUSTED_PROXY_CIDRS: '127.0.0.1',
      API_RATE_LIMIT_MAX: '1',
      API_RATE_LIMIT_TIME_WINDOW_MS: '60000',
    });
    server = testServer;
    testServer.register((routeServer, _pluginOptions, completePluginRegistration) => {
      routeServer.get('/limited', () => ({ status: 'ok' }));
      completePluginRegistration();
    });

    const firstClientResponse = await testServer.inject({
      method: 'GET',
      url: '/limited',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.5' },
    });
    const secondClientResponse = await testServer.inject({
      method: 'GET',
      url: '/limited',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    const secondClientRetryResponse = await testServer.inject({
      method: 'GET',
      url: '/limited',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });

    expect(firstClientResponse.statusCode).toBe(200);
    expect(secondClientResponse.statusCode).toBe(200);
    expect(secondClientRetryResponse.statusCode).toBe(429);
  });
});

function parseApiErrorResponse(payload: string): ApiErrorInput {
  return apiErrorSchema.parse(JSON.parse(payload) as unknown);
}
