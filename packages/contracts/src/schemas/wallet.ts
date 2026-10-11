import { z as zod } from 'zod';

import { currencyCodeSchema, resourceIdSchema, timestampSchema } from './common.js';

export const createWalletSchema = zod.object({
  name: zod.string().min(1).regex(/\S/),
  description: zod.string().optional(),
  reportingCurrency: currencyCodeSchema,
});

export const updateWalletSchema = zod.object({
  name: zod.string().min(1).regex(/\S/).optional(),
  description: zod.string().optional(),
});

export const walletSummarySchema = zod.object({
  id: resourceIdSchema,
  name: zod.string().min(1),
  description: zod.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  reportingCurrency: currencyCodeSchema,
});

export const walletListSchema = zod.object({
  wallets: zod.array(walletSummarySchema),
});
