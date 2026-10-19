import { describe, expect, it } from 'vitest';

import { currentMarketDate } from './market-date.js';

describe('when determining the current market date', () => {
  it.each([
    ['2026-01-01T02:00:00.000Z', '2025-12-31'],
    ['2026-01-01T04:59:59.999Z', '2025-12-31'],
    ['2026-01-01T05:00:00.000Z', '2026-01-01'],
    ['2026-07-01T03:59:00.000Z', '2026-06-30'],
    ['2026-07-01T04:00:00.000Z', '2026-07-01'],
  ])('should use the New York date for UTC instant %s', (timestamp, expected) => {
    // Arrange
    const instant = new Date(timestamp);

    // Act
    const result = currentMarketDate(instant);

    // Assert
    expect(result).toBe(expected);
  });
});
