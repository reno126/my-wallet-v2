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
      'INTERNAL_SERVER_ERROR',
    ]),
    message: zod.string().min(1),
    requestId: resourceIdSchema,
  }),
});

export type ApiErrorInput = zod.infer<typeof apiErrorSchema>;
