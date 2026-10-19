import { z as zod } from 'zod';

import { resourceIdSchema } from './common.js';

export const apiErrorSchema = zod.object({
  error: zod.object({
    code: zod.enum([
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'VALIDATION_FAILED',
      'PAYLOAD_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_QUOTA_EXHAUSTED',
      'PROVIDER_ERROR',
      'PROVIDER_TIMEOUT',
      'UNSUPPORTED_CURRENCY',
      'CURRENCY_UNAVAILABLE',
      'CURRENCY_MISMATCH',
      'PRICE_NOT_AVAILABLE',
      'PRICE_LOOKUP_INCOMPLETE',
      'INTERNAL_SERVER_ERROR',
    ]),
    message: zod.string().min(1),
    requestId: resourceIdSchema,
  }),
});

export type ApiErrorInput = zod.infer<typeof apiErrorSchema>;
