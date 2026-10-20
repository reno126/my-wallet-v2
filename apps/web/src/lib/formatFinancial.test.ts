import { describe, expect, it } from 'vitest';

import { compareQuantities, formatQuantity, formatUsd, multiplyDecimals } from './formatFinancial';

describe('when presenting exact financial strings', () => {
  it('should round positive and negative halfway amounts away from zero', () => {
    // Assert
    expect(formatUsd('1.005')).toBe('USD 1.01');
    expect(formatUsd('-1.005')).toBe('USD -1.01');
    expect(formatUsd('-0.0001')).toBe('USD 0.00');
    expect(formatUsd('9007199254740993.12345678', 4)).toBe('USD 9,007,199,254,740,993.1235');
    expect(formatQuantity('1.1234565')).toBe('1.123457');
    expect(formatQuantity('1.20000000')).toBe('1.2');
  });

  it('should calculate preview proceeds and compare shares without floating point', () => {
    // Assert
    expect(multiplyDecimals('0.00000001', '0.00000001')).toBe('0.0000000000000001');
    expect(multiplyDecimals('1.25', '12.50')).toBe('15.625');
    expect(compareQuantities('9007199254740993.00000001', '9007199254740993')).toBe(1);
    expect(compareQuantities('1.00', '1')).toBe(0);
    expect(multiplyDecimals('-1.25', '2')).toBe('-2.5');
    expect(() => compareQuantities('-1', '1')).toThrow(RangeError);
    expect(() => formatQuantity('-1')).toThrow(RangeError);
  });
});
