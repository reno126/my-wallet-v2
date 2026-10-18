import { errorCodes } from 'fastify';

import type { ApiFailure } from './api-failure.js';

export function getRequestFailure(error: unknown): ApiFailure | undefined {
  if (error instanceof errorCodes.FST_ERR_CTP_BODY_TOO_LARGE) {
    return { code: 'PAYLOAD_TOO_LARGE' };
  }

  if (error instanceof errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE) {
    return { code: 'UNSUPPORTED_MEDIA_TYPE' };
  }

  if (
    error instanceof errorCodes.FST_ERR_CTP_INVALID_JSON_BODY ||
    error instanceof errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY ||
    error instanceof errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH
  ) {
    return { code: 'VALIDATION_FAILED' };
  }

  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  if ('statusCode' in error && error.statusCode === 429) {
    return { code: 'RATE_LIMITED' };
  }

  if ('validation' in error && Array.isArray(error.validation)) {
    return { code: 'VALIDATION_FAILED' };
  }

  return undefined;
}
