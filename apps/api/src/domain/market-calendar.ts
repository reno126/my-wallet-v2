export function createMarketCalendar(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  function date(now: Date): string {
    const parts = formatter.formatToParts(now);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
      throw new Error('Unable to determine the quota date.');
    }
    return `${year.padStart(4, '0')}-${month}-${day}`;
  }

  function nextReset(now: Date): Date {
    const today = date(now);
    let before = now.getTime();
    let after = before + 28 * 60 * 60 * 1000;
    // Search UTC instants rather than adding 24 hours across a daylight-saving change.
    while (after - before > 1) {
      const middle = Math.floor((before + after) / 2);
      if (date(new Date(middle)) === today) {
        before = middle;
      } else {
        after = middle;
      }
    }
    return new Date(after);
  }

  return { date, nextReset };
}
