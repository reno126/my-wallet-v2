import { z as zod } from 'zod';

const symbolSchema = zod
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9.^=-]+$/);
const optionalNameSchema = zod.string().trim().max(300).nullish();
const optionalCurrencySchema = zod
  .string()
  .trim()
  .regex(/^([A-Za-z]{3})?$/)
  .nullish();
const optionalExchangeSchema = zod.string().trim().max(100).nullish();

export const fmpSearchResponseSchema = zod
  .array(
    zod.object({
      symbol: symbolSchema,
      name: optionalNameSchema,
      currency: optionalCurrencySchema,
      exchange: optionalExchangeSchema,
      isEtf: zod.boolean().nullish(),
      isFund: zod.boolean().nullish(),
    }),
  )
  .max(1_000);

export const fmpProfileResponseSchema = zod
  .array(
    zod.object({
      symbol: symbolSchema,
      companyName: optionalNameSchema,
      currency: optionalCurrencySchema,
      exchange: optionalExchangeSchema,
      isEtf: zod.boolean().nullish(),
      isFund: zod.boolean().nullish(),
    }),
  )
  .max(1);

export type FmpSearchCandidate = zod.infer<typeof fmpSearchResponseSchema>[number];
