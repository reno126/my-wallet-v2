import { z as zod } from 'zod';

import {
  currencyCodeSchema,
  dateOnlySchema,
  decimalStringSchema,
  nonnegativeDecimalStringSchema,
  paginationQuerySchema,
  paginationSchema,
  positiveDecimalStringSchema,
  resourceIdSchema,
  timestampSchema,
} from './common.js';
import { instrumentSymbolSchema } from './instrument.js';

export const transactionSideSchema = zod.enum(['BUY', 'SELL']);

export const transactionIdParamsSchema = zod.object({
  walletId: resourceIdSchema,
  transactionId: resourceIdSchema,
});

export const createTransactionSchema = zod.strictObject({
  symbol: instrumentSymbolSchema,
  side: transactionSideSchema,
  transactionDate: zod.iso.date().regex(/^(?!0000)/),
  quantity: positiveDecimalStringSchema,
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  description: zod.string().max(500).optional(),
});

export const createBuyTransactionSchema = createTransactionSchema.extend({
  side: zod.enum(['BUY']),
});

export const transactionSchema = zod.object({
  id: resourceIdSchema,
  walletId: resourceIdSchema,
  symbol: instrumentSymbolSchema,
  side: transactionSideSchema,
  transactionDate: dateOnlySchema,
  quantity: positiveDecimalStringSchema,
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  description: zod.string().optional(),
  createdAt: timestampSchema,
});

export const transactionResultSchema = zod.object({
  transaction: transactionSchema,
  holding: zod.object({
    walletId: resourceIdSchema,
    symbol: instrumentSymbolSchema,
    quantity: zod.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
    quoteCurrency: currencyCodeSchema,
  }),
});

export const buyTransactionResultSchema = transactionResultSchema.extend({
  holding: transactionResultSchema.shape.holding.extend({
    quantity: zod.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
  }),
});

export const transactionListQuerySchema = paginationQuerySchema.extend({
  symbol: instrumentSymbolSchema.optional(),
});

export const transactionHistoryEntrySchema = transactionSchema.extend({
  canDelete: zod
    .boolean()
    .describe(
      'Latest entry for its wallet/instrument in this snapshot; the DELETE endpoint rechecks eligibility.',
    ),
  totalAmount: nonnegativeDecimalStringSchema.describe(
    'Exact quantity multiplied by unit price, in the transaction currency.',
  ),
  realizedProfitLoss: decimalStringSchema
    .nullable()
    .describe('FIFO realized P/L for this SELL, in the transaction currency; null for BUY.'),
});

export const transactionListSchema = zod.strictObject({
  transactions: zod.array(transactionHistoryEntrySchema),
  pagination: paginationSchema,
});
