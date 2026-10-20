import type { createMarketCalendar } from './market-calendar.ts';

export interface PriceSnapshot {
  symbol: string;
  marketDate: string;
  unitPrice: string;
  currency: 'USD';
  source: 'FMP';
  retrievedAt: Date;
}

export function isPriceFresh(
  snapshot: PriceSnapshot | null,
  now: Date,
  calendar: ReturnType<typeof createMarketCalendar>,
): boolean {
  if (!snapshot || snapshot.retrievedAt > now) {
    return false;
  }
  const today = calendar.date(now);
  // A weekend/holiday quote can be current even though its market date is older.
  return snapshot.marketDate <= today && calendar.date(snapshot.retrievedAt) === today;
}
