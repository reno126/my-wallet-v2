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
