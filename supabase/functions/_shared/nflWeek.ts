const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value : '';

export function resolveCurrentNFLWeek(payload: unknown, now = new Date()): number | null {
  const scoreboard = object(payload);
  const reportedWeek = Number(object(scoreboard.week).number) || null;
  if (Number(object(scoreboard.season).type) !== 2) return reportedWeek;
  const regularSeason = array(object(array(scoreboard.leagues)[0]).calendar).map(object).find((entry) => text(entry.value) === '2');
  const easternDate = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')));
  };
  const easternNow = easternDate(now).getTime();
  const weeks = array(regularSeason?.entries).map(object).flatMap((entry) => {
    const start = Date.parse(text(entry.startDate));
    const week = Number(entry.value);
    if (!Number.isFinite(start) || !Number.isInteger(week) || week < 1 || week > 18) return [];
    const rollover = easternDate(new Date(start));
    rollover.setUTCDate(rollover.getUTCDate() - (rollover.getUTCDay() - 2 + 7) % 7);
    rollover.setUTCHours(12, 0, 0, 0);
    return [{ week, rollover: rollover.getTime() }];
  });
  return weeks.filter((entry) => entry.rollover <= easternNow)
    .sort((first, second) => second.rollover - first.rollover)[0]?.week ?? reportedWeek;
}
