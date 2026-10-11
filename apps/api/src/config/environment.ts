import { z as zod } from 'zod';

export const apiEnvironmentSchema = zod.object({
  NODE_ENV: zod.enum(['development', 'test', 'production']).default('development'),
  API_HOST: zod.string().trim().min(1).default('127.0.0.1'),
  PORT: zod.coerce.number().int().min(1).max(65_535).default(3000),
});

export type ApiEnvironmentInput = zod.infer<typeof apiEnvironmentSchema>;

export const apiEnvironment: ApiEnvironmentInput = apiEnvironmentSchema.parse(process.env);
