import { z as zod } from 'zod';

export const apiErrorSchema = zod.object({
  error: zod.object({
    code: zod.enum([
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
    ]),
    message: zod.string().min(1),
    requestId: zod.string().min(1),
  }),
});

export type ApiErrorInput = zod.infer<typeof apiErrorSchema>;
