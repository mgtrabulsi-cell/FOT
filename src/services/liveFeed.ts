// Reads the API-Sports live feed cached in Supabase by poll-sports-feed and
// overlays fresh scores, clocks and game states onto ESPN-shaped scoreboard games.
// ESPN remains the enrichment source and the automatic fallback when rows are stale.
import type { Game, GameStatus } from './sportsData.ts';

export type LiveFeedRow = {
  provider_game_id: string;
  start_time: string;
  away_name: string;
  home_name: string;
  away_score: number | null;
  home_score: number | null;
  away_linescore: number[];
  home_linescore: number[];
  status: GameStatus;
  period: number | null;
  clock: string | null;
  fetched_at: string;
};

type Config = { url: string; key: string };
const env = import.meta.env;
const configured = env?.VITE_SUPABASE_URL && (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)
  ? { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY } : null;

// NBA rows refresh slowly because the free API-Sports plan is capped at 100 requests/day.
export const liveFeedFreshnessMs: Record<'NFL' | 'NBA', number> = { NFL: 3 * 60_000, NBA: 25 * 60_000 };

function isGameStatus(value: unknown): value is GameStatus {
  return value === 'UPCOMING' || value === 'LIVE' || value === 'FINAL';
}

function scoreValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function linescore(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];
}

export function readLiveFeedRows(payload: unknown): LiveFeedRow[] {
  if (!Array.isArray(payload)) throw new Error('The live feed returned an invalid response.');
  return payload.flatMap((value): LiveFeedRow[] => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof row.provider_game_id !== 'string' || typeof row.away_name !== 'string' || typeof row.home_name !== 'string'
      || typeof row.start_time !== 'string' || !Number.isFinite(Date.parse(row.start_time))
      || typeof row.fetched_at !== 'string' || !Number.isFinite(Date.parse(row.fetched_at))
      || !isGameStatus(row.status)) return [];
    return [{
      provider_game_id: row.provider_game_id, start_time: row.start_time,
      away_name: row.away_name, home_name: row.home_name,
      away_score: scoreValue(row.away_score), home_score: scoreValue(row.home_score),
      away_linescore: linescore(row.away_linescore), home_linescore: linescore(row.home_linescore),
      status: row.status, period: scoreValue(row.period),
      clock: typeof row.clock === 'string' ? row.clock : null,
      fetched_at: row.fetched_at,
    }];
  });
}

export async function fetchLiveFeed(
  league: 'NFL' | 'NBA',
  signal?: AbortSignal,
  config: Config | null = configured,
  now = Date.now(),
): Promise<LiveFeedRow[]> {
  if (!config) return [];
  signal?.throwIfAborted();
  const query = new URLSearchParams({
    sport: `eq.${league}`,
    select: 'provider_game_id,start_time,away_name,home_name,away_score,home_score,away_linescore,home_linescore,status,period,clock,fetched_at',
    fetched_at: `gte.${new Date(now - liveFeedFreshnessMs[league]).toISOString()}`,
  });
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/live_feed_games?${query}`, {
    headers: { apikey: config.key, Accept: 'application/json' },
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!response.ok) throw new Error(`The live feed returned HTTP ${response.status}`);
  return readLiveFeedRows(await response.json());
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchKey(away: string, home: string): string {
  return `${normalizeName(away)}@${normalizeName(home)}`;
}

export function completedPeriodScores(
  row: Pick<LiveFeedRow, 'status' | 'period' | 'clock' | 'away_linescore' | 'home_linescore'>,
): NonNullable<Game['completedPeriods']> {
  const played = Math.min(row.away_linescore.length, row.home_linescore.length);
  const current = row.period ?? 1;
  const count = row.status === 'FINAL' ? played
    : Math.min(Math.max(current - (row.clock === 'Halftime' ? 0 : 1), 0), played);
  const scores: NonNullable<Game['completedPeriods']> = [];
  let away = 0, home = 0;
  for (let period = 1; period <= count; period++) {
    away += row.away_linescore[period - 1];
    home += row.home_linescore[period - 1];
    scores.push({ period, awayScore: away, homeScore: home });
  }
  return scores;
}

function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `OT${period - 4}`;
}

export function applyLiveFeed(games: Game[], rows: LiveFeedRow[]): Game[] {
  if (!rows.length) return games;
  const index = new Map<string, LiveFeedRow[]>();
  rows.forEach((row) => {
    if (row.status === 'UPCOMING') return;
    const key = matchKey(row.away_name, row.home_name);
    index.set(key, [...(index.get(key) ?? []), row]);
  });
  if (!index.size) return games;
  return games.map((game) => {
    const start = Date.parse(game.date);
    const row = (index.get(matchKey(game.away.name, game.home.name)) ?? [])
      .find((entry) => Number.isFinite(start) && Math.abs(Date.parse(entry.start_time) - start) <= 6 * 3_600_000);
    if (!row) return game;
    // Never roll a game ESPN already marked final back to live.
    if (game.status === 'FINAL' && row.status !== 'FINAL') return game;
    const live = row.status === 'LIVE';
    const periods = completedPeriodScores(row);
    return {
      ...game,
      status: row.status,
      away: { ...game.away, score: row.away_score ?? game.away.score },
      home: { ...game.home, score: row.home_score ?? game.home.score },
      period: live && row.period && row.period > 0 ? periodLabel(row.period) : game.period,
      clock: live ? row.clock ?? game.clock : row.status === 'FINAL' && game.status !== 'FINAL' ? 'Final' : game.clock,
      completedPeriods: periods.length ? periods : game.completedPeriods,
      situation: row.status === 'FINAL' ? undefined : game.situation,
      liveSource: 'api-sports' as const,
    };
  });
}

export async function withLiveFeed(games: Game[], league: 'NFL' | 'NBA', signal?: AbortSignal): Promise<Game[]> {
  try {
    return applyLiveFeed(games, await fetchLiveFeed(league, signal));
  } catch (error) {
    if (!signal?.aborted) console.warn(`${league} live feed is unavailable; showing feed scores`, error);
    return games;
  }
}
