import { Decimal } from '@prisma/client/runtime/client';

// Inputs have at most 30 significant digits; products have at most 60.
// Even summing the maximum JavaScript array length needs fewer than 70.
// Division is only for the displayed average, never for FIFO accounting.
const AccountingDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_UP });

export function financialDecimal(value: string): Decimal {
  return new AccountingDecimal(value);
}
