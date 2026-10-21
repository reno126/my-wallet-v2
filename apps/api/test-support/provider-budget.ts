import { createMarketCalendar } from '../src/domain/market-calendar.ts';

export function createTestProviderBudget(limit = 100) {
  let used = 0;
  const calendar = createMarketCalendar('America/New_York');
  return {
    reserveRequest() {
      if (used >= limit) {
        return Promise.resolve(false);
      }
      used++;
      return Promise.resolve(true);
    },
    read() {
      const now = new Date();
      return Promise.resolve({
        provider: 'FMP',
        quotaDate: calendar.date(now),
        timeZone: 'America/New_York',
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetsAt: calendar.nextReset(now),
      });
    },
    used: () => used,
  };
}
