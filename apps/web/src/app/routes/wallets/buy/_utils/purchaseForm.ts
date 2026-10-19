import { z as zod } from 'zod';

import { createBuyTransactionSchema } from '@my-wallets/contracts';

import { purchaseDictionary as text } from '../purchaseDictionary';

export function marketToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

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
  const [integer = '0', fraction = ''] = value.split('.');
  const rounded =
    BigInt(integer + fraction.padEnd(4, '0').slice(0, 4)) + ((fraction[4] ?? '0') >= '5' ? 1n : 0n);
  const digits = rounded.toString().padStart(5, '0');
  return `USD ${digits.slice(0, -4).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${digits.slice(-4)}`;
}
