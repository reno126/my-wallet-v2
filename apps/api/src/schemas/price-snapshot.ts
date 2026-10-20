import { z as zod } from 'zod';

import { positiveDecimalStringSchema } from '@my-wallets/contracts';

import type { PriceSnapshot } from '../domain/price-snapshot.ts';
import { normalizedInstrumentSymbolSchema } from './instrument-symbol.ts';

export const priceSnapshotSchema = zod.strictObject({
  symbol: normalizedInstrumentSymbolSchema,
  marketDate: zod.iso.date().regex(/^(?!0000)/),
  unitPrice: positiveDecimalStringSchema,
  currency: zod.literal('USD'),
  source: zod.literal('FMP'),
  retrievedAt: zod.date(),
}) satisfies zod.ZodType<PriceSnapshot>;
