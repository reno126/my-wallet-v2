import type { FastifyInstance } from 'fastify';

type SwaggerDocument = ReturnType<FastifyInstance['swagger']>;
type OpenApiDocument = Extract<SwaggerDocument, { openapi: string }>;

const rateLimitedResponse = {
  description: 'The client has exceeded its request limit.',
  headers: {
    'retry-after': {
      description: 'Seconds to wait before retrying.',
      schema: { type: 'string' },
    },
    'x-ratelimit-limit': {
      description: 'Maximum requests allowed in the current window.',
      schema: { type: 'string' },
    },
    'x-ratelimit-remaining': {
      description: 'Requests remaining in the current window.',
      schema: { type: 'string' },
    },
    'x-ratelimit-reset': {
      description: 'Seconds until the current window resets.',
      schema: { type: 'string' },
    },
  },
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const setCookieResponseHeader = {
  description: 'Session cookies set or cleared by Better Auth.',
  schema: { type: 'array', items: { type: 'string' } },
} as const;

export function addRateLimitContract(apiDocument: SwaggerDocument): OpenApiDocument {
  if (!isOpenApiDocument(apiDocument)) {
    throw new Error('The API contract must use OpenAPI 3.');
  }

  apiDocument.components ??= {};
  apiDocument.components.responses ??= {};
  apiDocument.components.responses['RateLimited'] = rateLimitedResponse;

  for (const pathItem of Object.values(apiDocument.paths ?? {})) {
    if (!pathItem) {
      continue;
    }

    for (const pathOperation of Object.values(pathItem)) {
      if (
        typeof pathOperation !== 'object' ||
        pathOperation === null ||
        !('responses' in pathOperation) ||
        !pathOperation.responses?.['429']
      ) {
        continue;
      }

      pathOperation.responses['429'] = { $ref: '#/components/responses/RateLimited' };
    }
  }

  addBetterAuthCookieHeaders(apiDocument);

  return apiDocument;
}

function addBetterAuthCookieHeaders(apiDocument: OpenApiDocument): void {
  for (const path of [
    '/auth/get-session',
    '/auth/sign-up/email',
    '/auth/sign-in/email',
    '/auth/sign-out',
  ]) {
    const pathItem = apiDocument.paths?.[path];

    if (!pathItem) {
      continue;
    }

    for (const operation of Object.values(pathItem)) {
      if (!isObjectRecord(operation) || !isObjectRecord(operation.responses)) {
        continue;
      }

      const successResponse = operation.responses['200'];

      if (!isObjectRecord(successResponse)) {
        continue;
      }

      successResponse.headers = {
        ...(isObjectRecord(successResponse.headers) ? successResponse.headers : {}),
        'set-cookie': setCookieResponseHeader,
      };
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpenApiDocument(apiDocument: SwaggerDocument): apiDocument is OpenApiDocument {
  return typeof apiDocument !== 'string' && 'openapi' in apiDocument;
}
