import { z as zod } from 'zod';

import { positiveDecimalStringSchema } from '@my-wallets/contracts';
import { sellTransactionSchema } from '@/lib/api/transactions';
import { compareQuantities } from '@/lib/formatFinancial';
import { marketToday } from '@/lib/marketDate';

import { ledgerDictionary as text } from '../ledgerDictionary';

export function sellFormSchema(available: string) {
  return zod.object({
    quantity: positiveDecimalStringSchema.pipe(
      zod
        .string()
        .refine((value) => compareQuantities(value, available) <= 0, text.sell.invalidQuantity),
    ),
    unitPrice: positiveDecimalStringSchema,
    transactionDate: sellTransactionSchema.shape.transactionDate.refine(
      (date) => date <= marketToday(),
      text.sell.invalidDate,
    ),
    description: zod.string().max(500),
  });
}

export type SellFormValues = zod.infer<ReturnType<typeof sellFormSchema>>;
