import { afterEach, describe, expect, it, vi } from 'vitest';
import { z as zod } from 'zod';

import { createTestServer, type TestServer } from '../../test-support/create-test-server.js';
import { createOpenApiValidator } from '../../test-support/openapi-contract.js';

describe('when validating OpenAPI string formats', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it.each([
    { format: 'uuid', valid: '82b93d15-aa8c-4e44-9709-50430aa54f56', invalid: 'not-a-uuid' },
    { format: 'date-time', valid: '2026-10-19T12:30:00Z', invalid: '2026-02-30T12:30:00Z' },
    { format: 'date', valid: '2024-02-29', invalid: '2026-02-29' },
    { format: 'email', valid: 'wallet@example.test', invalid: 'not-an-email' },
  ])(
    'should enforce $format without unknown-format warnings',
    async ({ format, valid, invalid }) => {
      // Arrange
      const warnings = vi.spyOn(console, 'warn');
      const testServer = createTestServer();
      server = testServer;
      let responseValue = valid;
      const url = '/api/contract-format';
      testServer.register((scope, _options, completePluginRegistration) => {
        scope.get(
          url,
          {
            schema: {
              operationId: 'getContractFormat',
              response: { 200: zod.object({ value: zod.string().meta({ format }) }) },
            },
          },
          () => ({ value: responseValue }),
        );
        completePluginRegistration();
      });
      await testServer.ready();
      const contract = await createOpenApiValidator(testServer);

      // Act
      const validResponse = await testServer.inject({ method: 'GET', url });
      responseValue = invalid;
      const invalidResponse = await testServer.inject({ method: 'GET', url });

      // Assert
      expect(validResponse.statusCode).toBe(200);
      expect(invalidResponse.statusCode).toBe(200);
      expect(() => contract.assertResponse('get', url, validResponse)).not.toThrow();
      expect(() => contract.assertResponse('get', url, invalidResponse)).toThrow();
      expect(warnings).not.toHaveBeenCalled();
    },
  );
});
