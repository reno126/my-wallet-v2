import { z as zod } from 'zod';

import {
  currencyCodeSchema,
  dateOnlySchema,
  positiveDecimalStringSchema,
  resourceIdSchema,
  timestampSchema,
} from './common.js';

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
