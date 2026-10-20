import { describe, expect, it } from 'vitest';

import { createMarketCalendar } from '../domain/market-calendar.ts';
import { refreshRetryDecision } from './refresh-retry.ts';

describe('when deciding refresh retry deadlines', () => {
  it.each([
    [1, 1000, true],
    [2, 2000, true],
    [3, 300000, false],
  ])('should apply a bounded backoff for attempt %s', (attempt, delay, retry) => {
    // Arrange
    const now = new Date('2026-11-02T17:00:00.000Z');

    // Act
    const decision = refreshRetryDecision(
      { code: 'PROVIDER_TIMEOUT', retryable: true },
      attempt,
      now,
      new Date('2026-11-03T05:00:00.000Z'),
    );

    // Assert
    expect(decision).toEqual({ retry, nextAttemptAt: new Date(now.getTime() + delay) });
  });

  it.each([
    ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
  ])('should defer exhausted quota at %s until the next local midnight', (instant, reset) => {
    // Arrange
    const now = new Date(instant);
    const calendar = createMarketCalendar('America/New_York');

    // Act
    const decision = refreshRetryDecision(
      { code: 'PROVIDER_QUOTA_EXHAUSTED', retryable: false },
      1,
      now,
      calendar.nextReset(now),
    );

    // Assert
    expect(decision).toEqual({ retry: false, nextAttemptAt: new Date(reset) });
  });
});
