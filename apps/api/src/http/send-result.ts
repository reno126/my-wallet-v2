import type { FastifyReply } from 'fastify';

import type { Result } from '../result.js';
import type { ApiFailure } from './api-failure.ts';
import { mapFailureToResponse } from './api-failure.ts';

export function sendResult<Value>(
  reply: FastifyReply,
  result: Result<Value, ApiFailure>,
  requestId: string,
): FastifyReply {
  if (result.ok) {
    return reply.send(result.value);
  }

  const failureResponse = mapFailureToResponse(result.error, requestId);

  return reply.code(failureResponse.statusCode).send(failureResponse.body);
}
