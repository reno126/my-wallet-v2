import { Decimal } from '@prisma/client/runtime/client';
import { z as zod } from 'zod';

import {
  dateOnlySchema,
  instrumentSymbolSchema,
  positiveDecimalStringSchema,
} from '@my-wallets/contracts';

import { fmpProfileResponseSchema } from './instruments.ts';

export const fmpHistoricalProfileSchema = zod
  .array(
    fmpProfileResponseSchema.element.extend({
      ipoDate: zod.union([dateOnlySchema, zod.literal('')]).nullish(),
    }),
  )
  .max(1);

const closeSchema = zod
  .string()
  .max(80)
  .regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/)
  .transform((value, context) => {
    const price = new Decimal(value);
    if (
      !price.isPositive() ||
      price.isZero() ||
      price.decimalPlaces() > 8 ||
      price.gte('10000000000000000000000')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The closing price is outside the supported exact-decimal range.',
      });
      return zod.NEVER;
    }
    return price.toFixed();
  })
  .pipe(positiveDecimalStringSchema);

export const fmpHistoricalPricesSchema = zod
  .array(
    zod.object({
      symbol: instrumentSymbolSchema,
      date: dateOnlySchema,
      close: closeSchema,
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
  return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }): unknown => {
    if (key === 'close' && typeof value === 'number') {
      // Use the original numeric token, never the rounded JavaScript number (Node 22.22+/24+).
      if (context?.source === undefined)
        throw new Error('JSON source access is required for exact prices.');
      return context.source;
    }
    return value;
  });
}
