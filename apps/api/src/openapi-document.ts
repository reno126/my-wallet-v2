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

  return apiDocument;
}

function isOpenApiDocument(apiDocument: SwaggerDocument): apiDocument is OpenApiDocument {
  return typeof apiDocument !== 'string' && 'openapi' in apiDocument;
}
