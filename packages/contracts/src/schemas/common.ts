import { z as zod } from 'zod';

export const currencyCodeSchema = zod.enum(['USD']);

export const decimalStringSchema = zod.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const nonnegativeDecimalStringSchema = zod.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

export const paginationQuerySchema = zod.strictObject({
  page: zod.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: zod.coerce.number().int().min(1).max(100).default(25),
});

export const paginationSchema = zod.strictObject({
  page: zod.number().int().min(1),
  pageSize: zod.number().int().min(1).max(100),
  totalCount: zod.number().int().nonnegative(),
  totalPages: zod.number().int().nonnegative(),
});

export const positiveDecimalStringSchema = zod
  .string()
  .regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,21})(?:\.\d{1,8})?$/);

export const dateOnlySchema = zod.iso.date();

export const timestampSchema = zod.iso.datetime();

export const resourceIdSchema = zod.string().uuid();

export const healthStatusSchema = zod.object({ status: zod.enum(['ok']) });
