import ajvFormats from 'ajv-formats';
import { OpenAPIBackend } from 'openapi-backend';
import { expect } from 'vitest';

import { addRateLimitContract } from '../src/openapi-document.js';
import type { TestServer } from './create-test-server.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';
type InjectResponse = Awaited<ReturnType<TestServer['inject']>>;

export async function createOpenApiValidator(server: TestServer) {
  const document = addRateLimitContract(server.swagger());
  const contractApi = new OpenAPIBackend({
    definition: document,
    strict: true,
    apiRoot: '/api',
    customizeAjv: (validator) => ajvFormats.default(validator),
  });
  await contractApi.init();

  return {
    document,
    operationIds: contractApi.router
      .getOperations()
      .flatMap((operation) => (operation.operationId ? [operation.operationId] : [])),
    assertResponse: (method: HttpMethod, path: string, response: InjectResponse) => {
      const matchedOperation = contractApi.matchOperation({ method, path, headers: {} });
      const operationId = matchedOperation?.operationId;
      expect(operationId).toBeDefined();

      const documentedResponse = matchedOperation?.responses?.[String(response.statusCode)];
      expect(documentedResponse).toBeDefined();

      const responseContent =
        documentedResponse && 'content' in documentedResponse
          ? documentedResponse.content
          : undefined;
      const documentedMediaTypes = Object.keys(responseContent ?? {});
      const responseMediaType = response.headers['content-type']?.split(';')[0];

      if (response.statusCode === 204) {
        expect(documentedMediaTypes).toEqual([]);
        expect(response.payload).toBe('');
        expect(responseMediaType).toBeUndefined();
      } else {
        const responseBody: unknown = response.json();
        const bodyValidation = contractApi.validateResponse(
          responseBody,
          operationId ?? '',
          response.statusCode,
        );
        expect(bodyValidation.valid).toBe(true);
        expect(documentedMediaTypes).toContain(responseMediaType);
      }

      const headerValidation = contractApi.validateResponseHeaders(
        response.headers,
        operationId ?? '',
        { statusCode: response.statusCode },
      );
      expect(headerValidation.valid).toBe(true);
    },
  };
}
