function decimalParts(value: string) {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new RangeError('Expected a plain decimal string.');
  }
  const negative = value.startsWith('-');
  const [integer = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return { negative, integer, fraction };
}

function roundDecimal(value: string, places: number): string {
  const { negative, integer, fraction } = decimalParts(value);
  const rounded =
    BigInt(integer + fraction.padEnd(places, '0').slice(0, places)) +
    ((fraction[places] ?? '0') >= '5' ? 1n : 0n);
  const digits = rounded.toString().padStart(places + 1, '0');
  return `${negative && rounded !== 0n ? '-' : ''}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

export function formatUsd(value: string, places: 2 | 4 = 2): string {
  const [integer = '0', fraction = ''] = roundDecimal(value, places).split('.');
  return `USD ${integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${fraction}`;
}

export function formatQuantity(value: string): string {
  if (decimalParts(value).negative) {
    throw new RangeError('Share quantity cannot be negative.');
  }
  return roundDecimal(value, 6).replace(/\.?0+$/u, '');
}

export function compareQuantities(left: string, right: string): number {
  const first = decimalParts(left);
  const second = decimalParts(right);
  if (first.negative || second.negative) {
    throw new RangeError('Share quantities cannot be negative.');
  }
  const places = Math.max(first.fraction.length, second.fraction.length);
  const firstValue = BigInt(first.integer + first.fraction.padEnd(places, '0'));
  const secondValue = BigInt(second.integer + second.fraction.padEnd(places, '0'));
  return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
}

export function multiplyDecimals(left: string, right: string): string {
  const first = decimalParts(left);
  const second = decimalParts(right);
  const places = first.fraction.length + second.fraction.length;
  const product = BigInt(first.integer + first.fraction) * BigInt(second.integer + second.fraction);
  const sign = first.negative !== second.negative && product !== 0n ? '-' : '';
  if (places === 0) {
    return sign + product.toString();
  }
  const digits = product.toString().padStart(places + 1, '0');
  return sign + `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/u, '');
}
