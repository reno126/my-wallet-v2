import { z as zod } from 'zod';

import {
  currencyCodeSchema,
  dateOnlySchema,
  decimalStringSchema,
  nonnegativeDecimalStringSchema,
  resourceIdSchema,
} from './common.js';
import { instrumentSymbolSchema } from './instrument.js';

export const holdingParamsSchema = zod.strictObject({
  walletId: resourceIdSchema,
  symbol: instrumentSymbolSchema,
});

export const holdingSchema = zod.strictObject({
  walletId: resourceIdSchema,
  symbol: instrumentSymbolSchema,
  name: zod.string(),
  exchange: zod.string(),
  quoteCurrency: currencyCodeSchema,
  quantity: nonnegativeDecimalStringSchema,
  remainingCostBasis: nonnegativeDecimalStringSchema.describe(
    'Original acquisition cost of remaining FIFO lots, without display rounding.',
  ),
  averageUnitCost: nonnegativeDecimalStringSchema
    .nullable()
    .describe(
      'Remaining cost divided by quantity at 100 significant digits; null when quantity is zero.',
    ),
  realizedProfitLoss: decimalStringSchema,
  lastTransactionDate: dateOnlySchema,
});

export const walletHoldingsSchema = zod.strictObject({
  walletId: resourceIdSchema,
  reportingCurrency: currencyCodeSchema,
  remainingCostBasis: nonnegativeDecimalStringSchema,
  realizedProfitLoss: decimalStringSchema,
  lastTransactionDate: dateOnlySchema.nullable(),
  holdings: zod
    .array(holdingSchema)
    .describe(
      'All instruments with ledger history, including closed positions, in ascending symbol order.',
    ),
});
