import { z as zod } from 'zod';

import { createBuyTransactionSchema } from '@my-wallets/contracts';
import { formatUsd } from '@/lib/formatFinancial';
import { marketToday } from '@/lib/marketDate';

import { purchaseDictionary as text } from '../purchaseDictionary';

export { marketToday };

export const purchaseFormSchema = createBuyTransactionSchema
  .pick({
    transactionDate: true,
    quantity: true,
    description: true,
  })
  .extend({
    transactionDate: zod
      .string({ error: text.invalidDate })
      .refine(
        (date) => createBuyTransactionSchema.shape.transactionDate.safeParse(date).success,
        text.invalidDate,
      )
      .refine((date) => date <= marketToday(), text.futureDate),
    quantity: createBuyTransactionSchema.shape.quantity,
    description: createBuyTransactionSchema.shape.description.unwrap(),
  });

export type PurchaseFormValues = zod.infer<typeof purchaseFormSchema>;

// Format only for presentation; the original decimal string is submitted unchanged.
export function formatUnitPrice(value: string): string {
  return formatUsd(value, 4);
}
