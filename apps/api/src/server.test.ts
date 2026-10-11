import { afterEach, describe, expect, it } from 'vitest';

import { type ApiErrorInput, apiErrorSchema } from '@my-wallets/contracts';

import { apiEnvironmentSchema } from './config/environment.js';
import { sendResult } from './http/send-result.js';
import { buildServer } from './server.js';

describe('API server error boundary', () => {
  let server: ReturnType<typeof buildServer> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('serves the API health endpoint', async () => {
    const testServer = buildServer({
      environment: apiEnvironmentSchema.parse({ NODE_ENV: 'test' }),
    });
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('maps an expected service failure to a safe public response', async () => {
    const testServer = buildServer({
      environment: apiEnvironmentSchema.parse({ NODE_ENV: 'test' }),
    });
    server = testServer;
    testServer.get('/failure', (request, reply) =>
      sendResult(reply, { ok: false, error: { code: 'NOT_FOUND' } }, request.id),
    );

    const response = await testServer.inject({ method: 'GET', url: '/failure' });

    expect(response.statusCode).toBe(404);
    const responseBody = parseApiErrorResponse(response.payload);

    expect(responseBody.error.code).toBe('NOT_FOUND');
    expect(responseBody.error.message).toBe('The requested resource was not found.');
    expect(responseBody.error.requestId).toBeTruthy();
  });

  it('sanitizes unexpected exceptions while retaining the request ID', async () => {
    const testServer = buildServer({
      environment: apiEnvironmentSchema.parse({ NODE_ENV: 'test' }),
    });
    server = testServer;
    testServer.get('/unexpected', () => {
      throw new Error('database connection string must remain private');
    });

    const response = await testServer.inject({ method: 'GET', url: '/unexpected' });
    const responseBody = parseApiErrorResponse(response.payload);

    expect(response.statusCode).toBe(500);
    expect(responseBody.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(responseBody.error.message).toBe('An unexpected error occurred.');
    expect(responseBody.error.requestId).toBeTruthy();
  });

  it('returns the common error DTO for unknown paths', async () => {
    const testServer = buildServer({
      environment: apiEnvironmentSchema.parse({ NODE_ENV: 'test' }),
    });
    server = testServer;

    const response = await testServer.inject({ method: 'GET', url: '/unknown' });

    expect(response.statusCode).toBe(404);
    const responseBody = parseApiErrorResponse(response.payload);

    expect(responseBody.error.code).toBe('NOT_FOUND');
    expect(responseBody.error.message).toBe('The requested resource was not found.');
    expect(responseBody.error.requestId).toBeTruthy();
  });
});

function parseApiErrorResponse(payload: string): ApiErrorInput {
  return apiErrorSchema.parse(JSON.parse(payload) as unknown);
}
