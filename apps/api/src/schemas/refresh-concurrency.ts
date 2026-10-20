import { z as zod } from 'zod';

export const refreshConcurrencySchema = zod.number().int().min(1).max(5).default(3);
