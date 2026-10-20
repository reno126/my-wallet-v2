import { Decimal } from '@prisma/client/runtime/client';
import { z as zod } from 'zod';

import { positiveDecimalStringSchema } from '@my-wallets/contracts';

export const exactPriceSchema = zod
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
        message: 'The price is outside the supported exact-decimal range.',
      });
      return zod.NEVER;
    }
    return price.toFixed();
  })
  .pipe(positiveDecimalStringSchema);

export function parseExactPriceJson(text: string, priceField: 'price' | 'close'): unknown {
  return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }): unknown => {
    if (key === priceField && typeof value === 'number') {
      if (context?.source === undefined) {
        throw new Error('JSON source access is required for exact prices.');
      }
      return context.source;
    }
    return value;
  });
}
