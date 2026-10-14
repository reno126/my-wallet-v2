import { z as zod } from 'zod';

import { currencyCodeSchema, resourceIdSchema, timestampSchema } from './common.js';

const walletNameSchema = zod.string().trim().min(1).max(100);
const walletDescriptionSchema = zod.string().trim().max(500);

export const createWalletSchema = zod
  .object({
    name: walletNameSchema,
    description: walletDescriptionSchema.optional(),
    reportingCurrency: currencyCodeSchema,
  })
  .strict();

export const updateWalletSchema = zod
  .object({
    name: walletNameSchema.optional(),
    description: walletDescriptionSchema.optional(),
  })
  .strict()
  .refine((changes) => Object.values(changes).some((value) => value !== undefined));

export const walletIdParamsSchema = zod.object({ walletId: zod.string().uuid() }).strict();

export const walletListQuerySchema = zod
  .object({
    page: zod.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: zod.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const walletSummarySchema = zod
  .object({
    id: resourceIdSchema,
    name: walletNameSchema,
    description: walletDescriptionSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    reportingCurrency: currencyCodeSchema,
  })
  .strict();

export const walletListSchema = zod
  .object({
    wallets: zod.array(walletSummarySchema),
    pagination: zod
      .object({
        page: zod.number().int().min(1),
        pageSize: zod.number().int().min(1).max(100),
        totalCount: zod.number().int().nonnegative(),
        totalPages: zod.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
