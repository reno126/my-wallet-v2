import { z as zod } from 'zod';

import { timestampSchema } from './common.js';

export const authUserSchema = zod.object({
  id: zod.string().min(1),
  email: zod.email(),
  name: zod.string().min(1),
});

export const authSessionSchema = zod.object({
  expiresAt: timestampSchema,
  user: authUserSchema,
});
