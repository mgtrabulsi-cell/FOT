// API-Sports live feed normalization and polling budget rules.
// Pure helpers shared by the poll-sports-feed function and Node tests; no Deno APIs here.

export type LiveFeedSport = 'NFL' | 'NBA';
export type LiveFeedStatus = 'UPCOMING' | 'LIVE' | 'FINAL';

export type LiveFeedGameRow = {
  sport: LiveFeedSport;
  provider_game_id: string;
  start_time: string;
  away_name: string;
  home_name: string;
  away_score: number | null;
  home_score: number | null;
  away_linescore: number[];
  home_linescore: number[];
  status: LiveFeedStatus;
  period: number | null;
  clock: string | null;
};

export type LiveFeedPollState = { day: string; requests_used: number; last_polled_at: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function readAPISportsResponse(payload: unknown): unknown[] {
  const data = record(payload);
  const errors = data.errors;
  const messages = Array.isArray(errors) ? errors.map((entry) => text(entry) || JSON.stringify(entry))
    : errors && typeof errors === 'object' ? Object.values(errors).map((entry) => text(entry) || JSON.stringify(entry)) : [];
  if (messages.length) throw new Error(`API-Sports reported: ${messages.join(' ')}`);
  if (!Array.isArray(data.response)) throw new Error('API-Sports returned an invalid response.');
  return data.response;
}

const nflLivePeriods: Record<string, number> = { Q1: 1, Q2: 2, HT: 2, Q3: 3, Q4: 4, OT: 5 };

function trimmedLinescore(values: Array<number | null>): number[] {
  const scores: number[] = [];
  for (const value of values) {
    if (value === null) break;
    scores.push(value);
  }
  return scores;
}

export function normalizeNFLGames(payload: unknown): LiveFeedGameRow[] {
  return readAPISportsResponse(payload).flatMap((item): LiveFeedGameRow[] => {
    const entry = record(item);
    const game = record(entry.game), teams = record(entry.teams), scores = record(entry.scores);
    const id = text(game.id), timestamp = num(record(game.date).timestamp);
    const away = text(record(teams.away).name), home = text(record(teams.home).name);
    if (!id || !away || !home || timestamp === null) return [];
    const status = record(game.status);
    const short = text(status.short).toUpperCase();
    const state: LiveFeedStatus = short === 'FT' || short === 'AOT' ? 'FINAL'
      : short in nflLivePeriods ? 'LIVE' : 'UPCOMING';
    const quarters = (side: unknown) => {
      const line = record(side);
      return trimmedLinescore(['quarter_1', 'quarter_2', 'quarter_3', 'quarter_4', 'overtime'].map((key) => num(line[key])));
    };
    return [{
      sport: 'NFL', provider_game_id: id,
      start_time: new Date(timestamp * 1000).toISOString(),
      away_name: away, home_name: home,
      away_score: num(record(scores.away).total), home_score: num(record(scores.home).total),
      away_linescore: quarters(scores.away), home_linescore: quarters(scores.home),
      status: state,
      period: state === 'LIVE' ? nflLivePeriods[short] : state === 'FINAL' ? (short === 'AOT' ? 5 : 4) : null,
      clock: state !== 'LIVE' ? null : short === 'HT' ? 'Halftime' : text(status.timer) || null,
    }];
  });
}

export function normalizeNBAGames(payload: unknown): LiveFeedGameRow[] {
  return readAPISportsResponse(payload).flatMap((item): LiveFeedGameRow[] => {
    const entry = record(item);
    if (text(entry.league) && text(entry.league) !== 'standard') return [];
    const id = text(entry.id), start = text(record(entry.date).start);
    const teams = record(entry.teams);
    const away = text(record(teams.visitors).name), home = text(record(teams.home).name);
    if (!id || !away || !home || !Number.isFinite(Date.parse(start))) return [];
    const status = record(entry.status);
    const short = num(status.short), long = text(status.long).toLowerCase();
    const state: LiveFeedStatus = short === 3 || long === 'finished' ? 'FINAL'
      : short === 1 || long === 'scheduled' || long === 'not started' ? 'UPCOMING' : 'LIVE';
    const scores = record(entry.scores);
    const line = (side: unknown) => {
      const row = record(side);
      return (Array.isArray(row.linescore) ? row.linescore : []).map(num).filter((value): value is number => value !== null);
    };
    return [{
      sport: 'NBA', provider_game_id: id,
      start_time: new Date(Date.parse(start)).toISOString(),
      away_name: away, home_name: home,
      away_score: num(record(scores.visitors).points), home_score: num(record(scores.home).points),
      away_linescore: state === 'UPCOMING' ? [] : line(scores.visitors),
      home_linescore: state === 'UPCOMING' ? [] : line(scores.home),
      status: state,
      period: num(record(entry.periods).current) || null,
      clock: state !== 'LIVE' ? null : status.halftime === true ? 'Halftime' : text(status.clock) || null,
    }];
  });
}

// Daily request budgets leave headroom under the subscribed API-Sports plans
// (NFL Pro: 7,500/day; NBA Free: 100/day). Each poll spends two requests.
export const liveFeedRequestBudget: Record<LiveFeedSport, number> = { NFL: 7000, NBA: 88 };
const liveCadenceMs: Record<LiveFeedSport, number> = { NFL: 55_000, NBA: 12 * 60_000 };
const idleCadenceMs: Record<LiveFeedSport, number> = { NFL: 15 * 60_000, NBA: 120 * 60_000 };
const liveWindowMs: Record<LiveFeedSport, number> = { NFL: 4.5 * 3_600_000, NBA: 3.5 * 3_600_000 };

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function decideLiveFeedPoll(
  sport: LiveFeedSport,
  now: Date,
  state: LiveFeedPollState | null,
  games: Array<{ start_time: string; status: LiveFeedStatus }>,
): { poll: boolean; reason: string } {
  const used = state && state.day === utcDay(now) ? state.requests_used : 0;
  if (used + 2 > liveFeedRequestBudget[sport]) return { poll: false, reason: 'The daily API-Sports request budget is spent.' };
  const last = state?.last_polled_at ? Date.parse(state.last_polled_at) : null;
  if (last === null || !Number.isFinite(last)) return { poll: true, reason: 'First poll.' };
  const active = games.some((game) => {
    if (game.status === 'LIVE') return true;
    if (game.status === 'FINAL') return false;
    const start = Date.parse(game.start_time);
    return Number.isFinite(start) && start - 15 * 60_000 <= now.getTime() && now.getTime() <= start + liveWindowMs[sport];
  });
  const cadence = active ? liveCadenceMs[sport] : idleCadenceMs[sport];
  if (now.getTime() - last < cadence) return { poll: false, reason: 'The live feed is up to date.' };
  return { poll: true, reason: active ? 'Games are in a live window.' : 'Scheduled refresh.' };
}

export function easternDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// API-Sports date filters use UTC calendar dates; an Eastern game day spans two of them.
export function liveFeedQueryDates(now: Date): [string, string] {
  const first = easternDate(now);
  return [first, new Date(Date.parse(`${first}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)];
}

export function nflSeasonYear(now: Date): number {
  const date = easternDate(now);
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  return month >= 3 ? year : year - 1;
}
