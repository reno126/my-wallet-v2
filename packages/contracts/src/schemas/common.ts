import { z as zod } from 'zod';

export const currencyCodeSchema = zod.enum(['USD']);

export const positiveDecimalStringSchema = zod
  .string()
  .regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,21})(?:\.\d{1,8})?$/);

export const dateOnlySchema = zod.iso.date();

export const timestampSchema = zod.iso.datetime();

export const resourceIdSchema = zod.string().uuid();

export const healthStatusSchema = zod.object({ status: zod.enum(['ok']) });
