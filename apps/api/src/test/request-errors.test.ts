import { afterEach, describe, expect, it } from 'vitest';

import { apiErrorMessages, apiErrorSchema } from '@my-wallets/contracts';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { createOpenApiValidator } from '../../test-support/openapi-contract.js';

describe('when wallet request bodies cannot be accepted', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it.each([
    {
      name: 'malformed JSON',
      payload: '{"private-value":',
      contentType: 'application/json',
      status: 400,
      code: 'VALIDATION_FAILED',
    },
    {
      name: 'empty JSON',
      payload: '',
      contentType: 'application/json',
      status: 400,
      code: 'VALIDATION_FAILED',
    },
    {
      name: 'invalid content length',
      payload: '{}',
      contentType: 'application/json',
      contentLength: '1',
      status: 400,
      code: 'VALIDATION_FAILED',
    },
    {
      name: 'oversized JSON',
      payload: JSON.stringify({ name: 'x'.repeat(1_048_576) }),
      contentType: 'application/json',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    },
    {
      name: 'unsupported content type',
      payload: '<private-value />',
      contentType: 'application/xml',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    },
  ] as const)(
    'should return a sanitized $status response for $name',
    async ({ payload, contentType, status, code, ...testCase }) => {
      // Arrange
      const testServer = createTestServer();
      server = testServer;
      await testServer.ready();
      const contract = await createOpenApiValidator(testServer);

      for (const method of ['POST', 'PATCH'] as const) {
        const path =
          method === 'POST' ? '/api/wallets' : '/api/wallets/fa8e5e7c-2ef9-4339-8435-0d8b416e8b14';

        // Act
        const response = await testServer.inject({
          method,
          url: path,
          headers: {
            'content-type': contentType,
            ...('contentLength' in testCase ? { 'content-length': testCase.contentLength } : {}),
          },
          payload,
        });

        // Assert
        expect(response.statusCode).toBe(status);
        contract.assertResponse(method === 'POST' ? 'post' : 'patch', path, response);
        const error = apiErrorSchema.parse(response.json()).error;
        expect(error).toMatchObject({
          code,
          message: apiErrorMessages[code],
        });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    },
  );

  it('should prevent caching authentication failures and early IP rate-limit responses', async () => {
    // Arrange
    const testServer = createTestServer({ API_RATE_LIMIT_MAX: '1' });
    server = testServer;
    await testServer.ready();
    const contract = await createOpenApiValidator(testServer);

    // Act
    const unauthenticatedResponse = await testServer.inject({ method: 'GET', url: '/api/wallets' });
    const rateLimitedResponse = await testServer.inject({ method: 'GET', url: '/api/wallets' });

    // Assert
    expect(unauthenticatedResponse.statusCode).toBe(401);
    expect(rateLimitedResponse.statusCode).toBe(429);
    expect(rateLimitedResponse.headers['retry-after']).toBeDefined();
    for (const response of [unauthenticatedResponse, rateLimitedResponse]) {
      contract.assertResponse('get', '/api/wallets', response);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const healthResponse = await testServer.inject({ method: 'GET', url: '/api/health' });
    expect(healthResponse.headers['cache-control']).toBeUndefined();
  });
});
