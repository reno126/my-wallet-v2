import { describe, expect, it } from 'vitest';

import {
  historicalWindowStart,
  previousDate,
  selectHistoricalPrice,
} from './historical-price-selection.js';

describe('when selecting a historical trading date', () => {
  it.each([
    ['2026-10-16', '2026-10-16'],
    ['2026-10-17', '2026-10-16'],
    ['2026-10-18', '2026-10-16'],
    ['2026-10-15', '2026-10-14'],
  ])('should select the latest available close on or before %s', (requestedDate, expectedDate) => {
    // Arrange
    const rows = ['2026-10-19', '2026-10-14', '2026-10-16'].map((date) => ({
      symbol: 'AAPL',
      date,
      close: '100',
    }));

    // Act
    const result = selectHistoricalPrice(rows, '2026-01-01', requestedDate);

    // Assert
    expect(result?.date).toBe(expectedDate);
  });

  it('should use an earlier-year quote after a long trading gap without assuming a weekday calendar', () => {
    // Arrange
    const rows = [{ symbol: 'AAPL', date: '2024-12-30', close: '100' }];

    // Act
    const result = selectHistoricalPrice(rows, '2021-01-01', '2026-10-18');

    // Assert
    expect(result?.date).toBe('2024-12-30');
  });

  it('should fall back across a market holiday and year boundary using the available records', () => {
    // Arrange
    const rows = [{ symbol: 'AAPL', date: '2025-12-31', close: '100' }];

    // Act
    const result = selectHistoricalPrice(rows, '2021-01-01', '2026-01-01');

    // Assert
    expect(result?.date).toBe('2025-12-31');
  });

  it('should never use a future quote or a quote outside the requested provider window', () => {
    // Arrange
    const rows = ['2020-01-01', '2026-10-19'].map((date) => ({
      symbol: 'AAPL',
      date,
      close: '100',
    }));

    // Act
    const result = selectHistoricalPrice(rows, '2021-01-01', '2026-10-18');

    // Assert
    expect(result).toBeUndefined();
  });

  it.each([
    ['2026-10-18', '1980-12-12', '2021-10-18'],
    ['2024-02-29', '1980-12-12', '2019-03-01'],
    ['2026-10-18', '2025-01-01', '2025-01-01'],
    ['0002-01-01', '0000-01-01', '0000-01-01'],
  ])(
    'should bound the window ending %s to provider range and IPO date',
    (to, earliest, expected) => {
      // Arrange
      // Act
      const result = historicalWindowStart(to, earliest);

      // Assert
      expect(result).toBe(expected);
    },
  );

  it.each([
    ['2024-03-01', '2024-02-29'],
    ['2026-01-01', '2025-12-31'],
  ])('should step backward from %s without overlapping windows', (date, expected) => {
    // Arrange
    // Act
    const result = previousDate(date);

    // Assert
    expect(result).toBe(expected);
  });
});
