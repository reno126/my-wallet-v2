import { describe, expect, it } from 'vitest';

import { createMarketCalendar } from './market-calendar.ts';
import { isPriceFresh, type PriceSnapshot } from './price-snapshot.ts';

const calendar = createMarketCalendar('America/New_York');

describe('when applying a configured quota-day boundary', () => {
  it.each([
    ['2026-01-02T04:59:59.999Z', '2026-01-01', '2026-01-02T05:00:00.000Z'],
    ['2026-01-02T05:00:00.000Z', '2026-01-02', '2026-01-03T05:00:00.000Z'],
    ['2026-03-08T05:00:00.000Z', '2026-03-08', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T04:00:00.000Z', '2026-11-01', '2026-11-02T05:00:00.000Z'],
  ])('should resolve %s without assuming a 24-hour day', (instant, day, reset) => {
    const now = new Date(instant);
    expect(calendar.date(now)).toBe(day);
    expect(calendar.nextReset(now).toISOString()).toBe(reset);
  });

  it('should use the configured timezone rather than the machine timezone or UTC date', () => {
    const now = new Date('2026-01-02T06:00:00.000Z');
    expect(calendar.date(now)).toBe('2026-01-02');
    expect(createMarketCalendar('America/Los_Angeles').date(now)).toBe('2026-01-01');
    expect(createMarketCalendar('UTC').nextReset(now).toISOString()).toBe(
      '2026-01-03T00:00:00.000Z',
    );
  });

  it('should reuse a successful same-day weekend quote without making yesterday’s retrieval fresh', () => {
    const now = new Date('2026-10-18T18:00:00.000Z');
    const snapshot: PriceSnapshot = {
      symbol: 'AAPL',
      marketDate: '2026-10-16',
      unitPrice: '190.12345678',
      currency: 'USD',
      source: 'FMP',
      retrievedAt: new Date('2026-10-18T17:00:00.000Z'),
    };
    expect(isPriceFresh(snapshot, now, calendar)).toBe(true);
    expect(
      isPriceFresh(
        { ...snapshot, retrievedAt: new Date('2026-10-18T03:59:59.999Z') },
        now,
        calendar,
      ),
    ).toBe(false);
    expect(isPriceFresh({ ...snapshot, marketDate: '2026-10-19' }, now, calendar)).toBe(false);
    expect(
      isPriceFresh(
        { ...snapshot, retrievedAt: new Date('2026-10-18T19:00:00.000Z') },
        now,
        calendar,
      ),
    ).toBe(false);
    expect(isPriceFresh(null, now, calendar)).toBe(false);
  });
});
