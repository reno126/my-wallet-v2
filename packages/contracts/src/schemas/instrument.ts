import { z as zod } from 'zod';

import {
  currencyCodeSchema,
  dateOnlySchema,
  positiveDecimalStringSchema,
  timestampSchema,
} from './common.js';

export const instrumentSymbolSchema = zod
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9.^=-]+$/);

export const instrumentPriceParamsSchema = zod.strictObject({ symbol: instrumentSymbolSchema });
export const instrumentPriceQuerySchema = zod.strictObject({ date: dateOnlySchema });
export const historicalPriceSchema = zod.object({
  symbol: instrumentSymbolSchema,
  requestedDate: dateOnlySchema,
  effectiveDate: dateOnlySchema,
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  source: zod.enum(['FMP']),
  retrievedAt: timestampSchema,
  usedPreviousTradingDay: zod.boolean(),
});

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
