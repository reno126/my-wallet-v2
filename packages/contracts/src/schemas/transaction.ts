import { z as zod } from 'zod';

import { currencyCodeSchema, dateOnlySchema, resourceIdSchema, timestampSchema } from './common.js';

const positiveDecimalStringSchema = zod
  .string()
  .regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,21})(?:\.\d{1,8})?$/);

export const transactionSideSchema = zod.enum(['BUY', 'SELL']);

export const createTransactionSchema = zod.object({
  symbol: zod.string().min(1),
  side: transactionSideSchema,
  transactionDate: dateOnlySchema,
  quantity: positiveDecimalStringSchema,
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  description: zod.string().optional(),
});

export const transactionSchema = zod.object({
  id: resourceIdSchema,
  walletId: resourceIdSchema,
  symbol: zod.string().min(1),
  side: transactionSideSchema,
  transactionDate: dateOnlySchema,
  quantity: positiveDecimalStringSchema,
  unitPrice: positiveDecimalStringSchema,
  currency: currencyCodeSchema,
  description: zod.string().optional(),
  createdAt: timestampSchema,
});

export const transactionListSchema = zod.object({
  transactions: zod.array(transactionSchema),
});
