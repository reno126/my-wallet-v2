import type { HistoricalClose } from './historical-price-provider.js';

export function selectHistoricalPrice(
  prices: HistoricalClose[],
  from: string,
  to: string,
): HistoricalClose | undefined {
  let selected: HistoricalClose | undefined;
  for (const price of prices) {
    if (price.date >= from && price.date <= to && (!selected || price.date > selected.date)) {
      selected = price;
    }
  }
  return selected;
}

export function historicalWindowStart(to: string, earliestDate: string): string {
  const date = new Date(`${to}T00:00:00.000Z`);
  date.setUTCFullYear(Math.max(0, date.getUTCFullYear() - 5));
  const fiveYearsEarlier = date.toISOString().slice(0, 10);
  return fiveYearsEarlier > earliestDate ? fiveYearsEarlier : earliestDate;
}

export function previousDate(date: string): string {
  const previous = new Date(`${date}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function currentMarketDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Unable to determine the current market date.');
  return `${year}-${month}-${day}`;
}
