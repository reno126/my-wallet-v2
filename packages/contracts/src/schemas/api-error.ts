import { z as zod } from 'zod';

export const apiErrorSchema = zod.object({
  error: zod.object({
    code: zod.string().min(1),
    message: zod.string().min(1),
    requestId: zod.string().min(1),
  }),
});

export type ApiErrorInput = zod.infer<typeof apiErrorSchema>;
