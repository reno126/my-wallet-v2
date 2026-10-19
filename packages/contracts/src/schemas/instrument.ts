import { z as zod } from 'zod';

import { currencyCodeSchema } from './common.js';

export const instrumentSchema = zod.object({
  symbol: zod.string().min(1),
  name: zod.string().min(1),
  exchange: zod.string().min(1).nullable(),
  quoteCurrency: currencyCodeSchema,
});

export const instrumentSearchQuerySchema = zod.strictObject({
  q: zod.string().min(1).max(100).regex(/\S/, 'Search must contain a non-whitespace character.'),
  mode: zod.enum(['symbol', 'name']).default('symbol'),
});

export const instrumentSearchResponseSchema = zod.object({
  results: zod.array(instrumentSchema).max(10),
  excluded: zod
    .array(
      zod.object({
        symbol: zod.string().min(1),
        quoteCurrency: zod
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
        reason: zod.enum([
          'NON_USD',
          'CURRENCY_MISMATCH',
          'UNSUPPORTED_INSTRUMENT',
          'DETAILS_UNAVAILABLE',
        ]),
      }),
    )
    .max(10),
});
