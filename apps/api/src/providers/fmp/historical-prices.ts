import { z as zod } from 'zod';

import { dateOnlySchema, instrumentSymbolSchema } from '@my-wallets/contracts';

import { exactPriceSchema, parseExactPriceJson } from './exact-price.ts';
import { fmpProfileResponseSchema } from './instruments.ts';

export const fmpHistoricalProfileSchema = zod
  .array(
    fmpProfileResponseSchema.element.extend({
      ipoDate: zod.union([dateOnlySchema, zod.literal('')]).nullish(),
    }),
  )
  .max(1);

export const fmpHistoricalPricesSchema = zod
  .array(
    zod.object({
      symbol: instrumentSymbolSchema,
      date: dateOnlySchema,
      close: exactPriceSchema,
      currency: zod
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/)
        .nullish(),
    }),
  )
  .max(2_000);

export type FmpHistoricalPrice = zod.infer<typeof fmpHistoricalPricesSchema>[number];

export function parseHistoricalPriceJson(text: string): unknown {
  return parseExactPriceJson(text, 'close');
}
