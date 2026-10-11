import { z as zod } from 'zod';

import { currencyCodeSchema } from './common.js';

export const instrumentSchema = zod.object({
  symbol: zod.string().min(1),
  name: zod.string().min(1),
  exchange: zod.string().min(1).nullable(),
  quoteCurrency: currencyCodeSchema,
});

export const instrumentSearchQuerySchema = zod.object({
  q: zod.string().min(1).max(100),
});

export const instrumentSearchResponseSchema = zod.object({
  results: zod.array(instrumentSchema),
});
