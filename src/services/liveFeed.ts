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

// Final scores never go stale, so rows stay useful long after polling slows down;
// the overlay applies per-league freshness to LIVE rows itself.
const feedLookbackMs = 48 * 3_600_000;

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
    fetched_at: `gte.${new Date(now - feedLookbackMs).toISOString()}`,
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

export function applyLiveFeed(games: Game[], rows: LiveFeedRow[], now = Date.now()): Game[] {
  if (!rows.length) return games;
  const index = new Map<string, LiveFeedRow[]>();
  rows.forEach((row) => {
    const key = matchKey(row.away_name, row.home_name);
    index.set(key, [...(index.get(key) ?? []), row]);
  });
  return games.map((game) => {
    const start = Date.parse(game.date);
    const row = (index.get(matchKey(game.away.name, game.home.name)) ?? [])
      .find((entry) => Number.isFinite(start) && Math.abs(Date.parse(entry.start_time) - start) <= 6 * 3_600_000);
    if (!row) return game;
    const league = game.league === 'NBA' ? 'NBA' : 'NFL';
    // Final rows never go stale; live rows must be fresh to override the feed.
    const fresh = row.status === 'FINAL' || now - Date.parse(row.fetched_at) <= liveFeedFreshnessMs[league];
    // Never roll a game ESPN already marked final back to live, and never let
    // pregame or stale rows override live data — but keep the provider link.
    if (row.status === 'UPCOMING' || !fresh || (game.status === 'FINAL' && row.status !== 'FINAL')) {
      return { ...game, providerGameId: row.provider_game_id };
    }
    const live = row.status === 'LIVE';
    const periods = completedPeriodScores(row);
    return {
      ...game,
      providerGameId: row.provider_game_id,
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

// --- Per-game box score details from API-Sports ---

export type LiveFeedDetailPlayer = { id: string; name: string; image: string | null; stats: Array<{ name: string; value: string | null }> };
export type LiveFeedDetailTeam = {
  apiSportsId: string;
  name: string;
  groups: Array<{ name: string; players: LiveFeedDetailPlayer[] }>;
  teamStats: Array<{ name: string; value: string }>;
};
export type LiveFeedGameDetails = {
  status: GameStatus;
  clock: string | null;
  period: number | null;
  away: LiveFeedDetailTeam | null;
  home: LiveFeedDetailTeam | null;
  fetched_at: string;
};

// Live box stats refresh about every three minutes server-side.
const detailFreshnessMs = 6 * 60_000;

export async function fetchLiveFeedGameDetails(
  league: 'NFL' | 'NBA',
  providerGameId: string,
  signal?: AbortSignal,
  config: Config | null = configured,
  now = Date.now(),
): Promise<LiveFeedGameDetails | null> {
  if (!config || !providerGameId) return null;
  signal?.throwIfAborted();
  const query = new URLSearchParams({
    sport: `eq.${league}`, provider_game_id: `eq.${providerGameId}`, select: 'status,payload,fetched_at', limit: '1',
  });
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/live_feed_game_details?${query}`, {
    headers: { apikey: config.key, Accept: 'application/json' },
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!response.ok) throw new Error(`Game details returned HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : {};
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : null;
  if (!payload || typeof row.fetched_at !== 'string' || !Number.isFinite(Date.parse(row.fetched_at)) || !isGameStatus(payload.status)) return null;
  // Finished games never go stale; live details must be recent to be trusted.
  if (payload.status === 'LIVE' && now - Date.parse(row.fetched_at) > detailFreshnessMs) return null;
  const team = (value: unknown): LiveFeedDetailTeam | null => {
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (!entry || typeof entry.apiSportsId !== 'string' || typeof entry.name !== 'string' || !Array.isArray(entry.groups)) return null;
    return entry as unknown as LiveFeedDetailTeam;
  };
  return {
    status: payload.status,
    clock: typeof payload.clock === 'string' ? payload.clock : null,
    period: typeof payload.period === 'number' && Number.isFinite(payload.period) ? payload.period : null,
    away: team(payload.away), home: team(payload.home),
    fetched_at: row.fetched_at,
  };
}

const statLabels: Record<string, string> = {
  'comp att': 'C/ATT', yards: 'YDS', average: 'AVG', 'passing touch downs': 'TD', interceptions: 'INT',
  sacks: 'SACKS', rating: 'RTG', 'two pt': '2PT', 'total rushes': 'CAR', 'rushing touch downs': 'TD',
  'longest rush': 'LONG', receptions: 'REC', 'receiving touch downs': 'TD', 'longest reception': 'LONG',
  targets: 'TGTS', 'yards after catch': 'YAC', tackles: 'TCKL', 'unassisted tackles': 'SOLO',
  'total tackles': 'TOT', 'tackles for loss': 'TFL', 'passes defended': 'PD', 'qb hits': 'QB HTS',
  'intercepted touch downs': 'TD', 'intercepted yards': 'YDS', 'fumbles recovered': 'FR', 'fumbles lost': 'LOST',
  fumbles: 'FUM', 'field goals': 'FG', 'field goals from 1 19 yards': '1-19', 'field goals from 20 29 yards': '20-29',
  'field goals from 30 39 yards': '30-39', 'field goals from 40 49 yards': '40-49', 'field goals from 50 yards': '50+',
  'extra points': 'XP', punts: 'PUNTS', 'longest punt': 'LONG', touchbacks: 'TB', 'inside 20': 'IN 20',
  total: 'TOT', 'longest kick return': 'LONG', 'longest punt return': 'LONG',
};

function statLabel(name: string): string {
  const known = statLabels[name.toLowerCase()];
  if (known) return known;
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.map((word) => word[0]?.toUpperCase() ?? '').join('') : name.toUpperCase().slice(0, 6);
}

// Aligns API-Sports group names with the ESPN category names the filters expect.
const categoryNames: Record<string, string> = {
  'kick returns': 'kickReturns', 'punt returns': 'puntReturns', defense: 'defensive',
};

function categoryName(group: string): string {
  const name = group.trim().toLowerCase();
  return categoryNames[name] ?? name;
}

type BoxTeamShape = {
  id: string; name: string; abbreviation: string; score: string;
  logo?: string; color?: string; record?: string; homeAway: 'home' | 'away';
  linescores: string[];
  categories: Array<{ name: string; title: string; labels: string[]; totals?: string[];
    athletes: Array<{ id: string; name: string; shortName: string; jersey: string; headshot: string; position: string; stats: string[] }> }>;
  teamStats: Array<{ name: string; label: string; displayValue: string }>;
};

function boxTeam(detail: LiveFeedDetailTeam, side: Game['away'], homeAway: 'home' | 'away', game: Game): BoxTeamShape {
  const categories = detail.groups.flatMap((group) => {
    if (!group.players.length) return [];
    // Column set: the first player's stats, dropping columns no player has.
    const names = group.players[0].stats.map((stat) => stat.name)
      .filter((name) => group.players.some((player) => player.stats.some((stat) => stat.name === name && stat.value !== null && stat.value !== '')));
    if (!names.length) return [];
    return [{
      name: categoryName(group.name),
      title: group.name,
      labels: names.map(statLabel),
      athletes: group.players.map((player) => ({
        id: player.id,
        name: player.name,
        shortName: player.name.replace(/^(\S)\S*\s+/, '$1. '),
        jersey: '',
        headshot: player.image ?? '',
        position: '',
        stats: names.map((name) => player.stats.find((stat) => stat.name === name)?.value ?? '-'),
      })),
    }];
  });
  const periods = game.completedPeriods ?? [];
  return {
    id: side.id, name: side.name, abbreviation: side.abbr, score: String(side.score),
    logo: side.logo, color: side.color, record: side.record, homeAway,
    linescores: periods.map((period, index) => {
      const previous = periods[index - 1];
      const total = homeAway === 'away' ? period.awayScore : period.homeScore;
      const before = previous ? (homeAway === 'away' ? previous.awayScore : previous.homeScore) : 0;
      return String(total - before);
    }),
    categories,
    teamStats: detail.teamStats.map((stat) => ({ name: stat.name, label: stat.name, displayValue: stat.value })),
  };
}

// Builds the box score the matchup view renders from cached API-Sports details,
// keeping ESPN identity fields (team IDs, logos, records) from the matched game.
export function apiSportsBoxScore(details: LiveFeedGameDetails, game: Game): {
  eventId: string; status: string; state: 'pre' | 'in' | 'post'; clock: string; period: number;
  isLive: boolean; isFinal: boolean; venue?: string; teams: [BoxTeamShape, BoxTeamShape] | []; source: 'api-sports';
} | null {
  if (!details.away || !details.home || details.status === 'UPCOMING') return null;
  const away = boxTeam(details.away, game.away, 'away', game);
  const home = boxTeam(details.home, game.home, 'home', game);
  if (!away.categories.some((category) => category.athletes.length) && !home.categories.some((category) => category.athletes.length)) return null;
  const isLive = details.status === 'LIVE';
  const period = details.period ?? (isLive ? 0 : 4);
  const label = period > 0 ? (period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `OT${period - 4}`) : '';
  return {
    eventId: game.eventId,
    status: isLive ? [label, details.clock].filter(Boolean).join(' · ') || 'Live' : 'Final',
    state: isLive ? 'in' : 'post',
    clock: details.clock ?? '',
    period,
    isLive, isFinal: !isLive,
    venue: game.venue,
    teams: [away, home],
    source: 'api-sports',
  };
}
