import { Decimal } from '@prisma/client/runtime/client';

import { financialDecimal } from './decimal.ts';

interface UsdAmount {
  amount: string;
  currency: 'USD';
}

function presentationDecimal(value: string): Decimal {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new RangeError('Presentation requires a plain decimal string.');
  }
  return financialDecimal(value);
}

function formatUsd(value: UsdAmount, decimalPlaces: number): string {
  const rounded = presentationDecimal(value.amount).toDecimalPlaces(
    decimalPlaces,
    Decimal.ROUND_HALF_UP,
  );
  return (rounded.isZero() ? financialDecimal('0') : rounded).toFixed(decimalPlaces);
}

export function formatUsdAmount(value: UsdAmount): string {
  return formatUsd(value, 2);
}

export function formatUsdUnitPrice(value: UsdAmount): string {
  return formatUsd(value, 4);
}

export function formatShareQuantity(value: string): string {
  const quantity = presentationDecimal(value);
  if (quantity.isNegative() && !quantity.isZero()) {
    throw new RangeError('Share quantity cannot be negative.');
  }
  const rounded = quantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? '0' : rounded.toFixed();
}
