// Reads the API-Sports live feed cached in Supabase by poll-sports-feed and
// overlays fresh scores, clocks and game states onto ESPN-shaped scoreboard games.
// ESPN remains the enrichment source and the automatic fallback when rows are stale.
import type { Game, GameStatus } from './sportsData.ts';
import { isHalftime } from './sportsData.ts';

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
      period: live && row.period && row.period > 0
        ? isHalftime(periodLabel(row.period), row.clock ?? '') ? 'Halftime' : periodLabel(row.period)
        : game.period,
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
  'longest rush': 'LONG', receptions: 'REC', 'total receptions': 'REC', 'receiving touch downs': 'TD',
  'longest reception': 'LONG', targets: 'TGTS', 'yards after catch': 'YAC', tackles: 'TCKL',
  'unassisted tackles': 'SOLO', 'total tackles': 'TOT', 'tackles for loss': 'TFL', tfl: 'TFL',
  'passes defended': 'PD', 'qb hts': 'QB HIT', 'qb hits': 'QB HIT', 'interceptions for touch downs': 'INT TD',
  'blocked kicks': 'BLK', 'total interceptions': 'INT', 'intercepted touch downs': 'TD', 'intercepted yards': 'YDS',
  'fumbles recovered': 'FR', 'fumbles lost': 'LOST', lost: 'LOST', rec: 'REC', 'rec td': 'REC TD',
  fumbles: 'FUM', 'kick return td': 'RET TD', 'exp return td': 'XP RET',
  'field goals': 'FG', pct: 'PCT', points: 'PTS', 'extra point': 'XP', 'extra points': 'XP',
  'field goals from 1 19 yards': '1-19', 'field goals from 20 29 yards': '20-29',
  'field goals from 30 39 yards': '30-39', 'field goals from 40 49 yards': '40-49', 'field goals from 50 yards': '50+',
  punts: 'PUNTS', 'longest punt': 'LONG', long: 'LONG', lg: 'LG', touchbacks: 'TB', 'inside 20': 'IN 20', in20: 'IN 20',
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
      athletes: group.players.map((player) => {
        const name = player.name.trim().replace(/\s+/g, ' ');
        return {
          id: player.id,
          name,
          shortName: name.replace(/^(\S)\S*\s+/, '$1. '),
          jersey: '',
          headshot: player.image ?? '',
          position: '',
          stats: names.map((statName) => player.stats.find((stat) => stat.name === statName)?.value ?? '-'),
        };
      }),
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

// --- Season team averages from API-Sports (Team Comparison) ---

export type NFLSeasonAverages = {
  teamId: string;
  pointsPerGame: number | null;
  totalYardsPerGame: number | null;
  passingYardsPerGame: number | null;
  rushingYardsPerGame: number | null;
  pointsAllowedPerGame: number | null;
  totalYardsAllowedPerGame: number | null;
  passingYardsAllowedPerGame: number | null;
  rushingYardsAllowedPerGame: number | null;
  source: 'api-sports';
};

function teamAverages(teamId: string, rows: Array<Record<string, unknown>>): NFLSeasonAverages {
  // A metric is only reported when every synced game carries it; partial data stays unavailable.
  const average = (key: string): number | null => {
    const values = rows.map((row) => row[key]);
    if (!rows.length || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
    return Math.round(((values as number[]).reduce((sum, value) => sum + value, 0) / rows.length) * 10) / 10;
  };
  return {
    teamId,
    pointsPerGame: average('points_for'),
    totalYardsPerGame: average('yards'),
    passingYardsPerGame: average('pass_yards'),
    rushingYardsPerGame: average('rush_yards'),
    pointsAllowedPerGame: average('points_against'),
    totalYardsAllowedPerGame: average('yards_against'),
    passingYardsAllowedPerGame: average('pass_yards_against'),
    rushingYardsAllowedPerGame: average('rush_yards_against'),
    source: 'api-sports',
  };
}

const seasonCache = new Map<number, { expires: number; request: Promise<Map<string, NFLSeasonAverages> | null> }>();

// Season averages are only served when the server has synced every regular-season
// final; otherwise partial sums would misstate per-game averages.
export function fetchNFLSeasonAveragesFeed(
  season: number,
  signal?: AbortSignal,
  config: Config | null = configured,
): Promise<Map<string, NFLSeasonAverages> | null> {
  if (!config || !Number.isInteger(season)) return Promise.resolve(null);
  signal?.throwIfAborted();
  const cached = seasonCache.get(season);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request = (async () => {
    const headers = { apikey: config.key, Accept: 'application/json' };
    const base = `${config.url.replace(/\/$/, '')}/rest/v1`;
    const stateQuery = new URLSearchParams({ sport: 'eq.NFL', season: `eq.${season}`, select: 'finals_total,finals_synced', limit: '1' });
    const stateResponse = await fetch(`${base}/live_feed_season_state?${stateQuery}`, { headers, signal: AbortSignal.timeout(4000) });
    if (!stateResponse.ok) throw new Error(`Season sync state returned HTTP ${stateResponse.status}`);
    const stateRows: unknown = await stateResponse.json();
    const state = Array.isArray(stateRows) && stateRows[0] && typeof stateRows[0] === 'object' ? stateRows[0] as Record<string, unknown> : null;
    if (!state || typeof state.finals_total !== 'number' || typeof state.finals_synced !== 'number'
      || state.finals_total === 0 || state.finals_synced < state.finals_total) return null;
    const rowsQuery = new URLSearchParams({
      sport: 'eq.NFL', season: `eq.${season}`, espn_team_id: 'not.is.null',
      select: 'espn_team_id,points_for,points_against,yards,pass_yards,rush_yards,yards_against,pass_yards_against,rush_yards_against',
      limit: '1200',
    });
    const rowsResponse = await fetch(`${base}/live_feed_team_games?${rowsQuery}`, { headers, signal: AbortSignal.timeout(6000) });
    if (!rowsResponse.ok) throw new Error(`Season team games returned HTTP ${rowsResponse.status}`);
    const rows: unknown = await rowsResponse.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const byTeam = new Map<string, Array<Record<string, unknown>>>();
    for (const value of rows) {
      const row = value && typeof value === 'object' ? value as Record<string, unknown> : null;
      if (!row || typeof row.espn_team_id !== 'string') continue;
      byTeam.set(row.espn_team_id, [...(byTeam.get(row.espn_team_id) ?? []), row]);
    }
    return new Map([...byTeam.entries()].map(([teamId, games]) => [teamId, teamAverages(teamId, games)]));
  })();
  const entry = { request, expires: Date.now() + 5 * 60_000 };
  seasonCache.set(season, entry);
  void request.then((result) => {
    if (result === null && seasonCache.get(season) === entry) entry.expires = Date.now() + 60_000;
  }, () => {
    if (seasonCache.get(season) === entry) seasonCache.delete(season);
  });
  return request;
}

// --- NFL roster bridge (Stat Hub, player search, favorable matchups) ---

export type NFLRosterFeedPlayer = { id: string; name: string; position: string; jersey: string };

// Serves the active roster for one team from the server-synced bridge.
// Returns null when the bridge has no fresh rows so callers fall back to ESPN.
export async function fetchNFLRosterFeed(
  season: number,
  espnTeamId: string,
  signal?: AbortSignal,
  config: Config | null = configured,
  now = Date.now(),
): Promise<NFLRosterFeedPlayer[] | null> {
  if (!config || !Number.isInteger(season) || !espnTeamId) return null;
  signal?.throwIfAborted();
  const query = new URLSearchParams({
    sport: 'eq.NFL', season: `eq.${season}`, espn_team_id: `eq.${espnTeamId}`, active: 'is.true',
    select: 'espn_player_id,name,position,jersey,updated_at', limit: '200',
  });
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/live_feed_rosters?${query}`, {
    headers: { apikey: config.key, Accept: 'application/json' },
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!response.ok) throw new Error(`The roster bridge returned HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const players = rows.flatMap((value): NFLRosterFeedPlayer[] => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof row.espn_player_id !== 'string' || typeof row.name !== 'string'
      || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) return [];
    // Rosters older than two days are stale; the daily sync should have replaced them.
    if (now - Date.parse(row.updated_at) > 48 * 3_600_000) return [];
    return [{
      id: row.espn_player_id, name: row.name,
      position: typeof row.position === 'string' ? row.position : '',
      jersey: typeof row.jersey === 'string' ? row.jersey : '',
    }];
  });
  return players.length === rows.length && players.length ? players : null;
}

// --- NFL player game logs from API-Sports ---

type PlayerLogContext = { gameId: string; date: string };

const playerLogGates = new Map<number, { expires: number; request: Promise<boolean> }>();

// Game logs are only served once every regular-season final has player stats synced;
// otherwise a missing game would silently read as "did not play".
function playerLogsComplete(season: number, config: Config): Promise<boolean> {
  const cached = playerLogGates.get(season);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request = (async () => {
    const query = new URLSearchParams({ sport: 'eq.NFL', season: `eq.${season}`, select: 'finals_total,players_synced', limit: '1' });
    const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/live_feed_season_state?${query}`, {
      headers: { apikey: config.key, Accept: 'application/json' }, signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Season sync state returned HTTP ${response.status}`);
    const rows: unknown = await response.json();
    const state = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : null;
    return !!state && typeof state.finals_total === 'number' && typeof state.players_synced === 'number'
      && state.finals_total > 0 && state.players_synced >= state.finals_total;
  })();
  playerLogGates.set(season, { expires: Date.now() + 60_000, request });
  void request.catch(() => playerLogGates.delete(season));
  return request;
}

const statKeys = new Set(['completions', 'attempts', 'passingYards', 'passingTouchdowns', 'interceptions',
  'carries', 'rushingYards', 'rushingTouchdowns', 'receptions', 'targets', 'receivingYards', 'receivingTouchdowns', 'totalYards']);

function readPlayerStats(value: unknown): Record<string, number> {
  const stats = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(stats)
    .filter(([key, entry]) => statKeys.has(key) && typeof entry === 'number' && Number.isFinite(entry))) as Record<string, number>;
}

// Returns per-recent-game stat records for one player, or null to fall back to ESPN.
// A fresh sync with no row for a played game honestly reads as no recorded stats.
export async function fetchNFLPlayerGameLogFeed(
  season: number,
  espnPlayerId: string,
  recentGames: PlayerLogContext[],
  signal?: AbortSignal,
  config: Config | null = configured,
): Promise<Map<string, Record<string, number>> | null> {
  if (!config || !Number.isInteger(season) || !espnPlayerId || !recentGames.length) return null;
  signal?.throwIfAborted();
  if (!(await playerLogsComplete(season, config))) return null;
  const headers = { apikey: config.key, Accept: 'application/json' };
  const base = `${config.url.replace(/\/$/, '')}/rest/v1`;
  const bridgeQuery = new URLSearchParams({
    sport: 'eq.NFL', season: `eq.${season}`, espn_player_id: `eq.${espnPlayerId}`, select: 'api_player_id', limit: '1',
  });
  const bridgeResponse = await fetch(`${base}/live_feed_rosters?${bridgeQuery}`, {
    headers, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!bridgeResponse.ok) throw new Error(`The roster bridge returned HTTP ${bridgeResponse.status}`);
  const bridgeRows: unknown = await bridgeResponse.json();
  const bridge = Array.isArray(bridgeRows) && bridgeRows[0] && typeof bridgeRows[0] === 'object' ? bridgeRows[0] as Record<string, unknown> : null;
  if (!bridge || typeof bridge.api_player_id !== 'string' || !bridge.api_player_id) return null;
  const logQuery = new URLSearchParams({
    sport: 'eq.NFL', season: `eq.${season}`, api_player_id: `eq.${bridge.api_player_id}`,
    select: 'provider_game_id,game_date,stats', limit: '40',
  });
  const logResponse = await fetch(`${base}/live_feed_player_games?${logQuery}`, {
    headers, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!logResponse.ok) throw new Error(`Player game logs returned HTTP ${logResponse.status}`);
  const rows: unknown = await logResponse.json();
  if (!Array.isArray(rows)) throw new Error('Player game logs returned an invalid response.');
  const entries = rows.flatMap((value): Array<{ time: number; stats: Record<string, number> }> => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof row.game_date !== 'string') return [];
    const time = Date.parse(`${row.game_date}T12:00:00Z`);
    return Number.isFinite(time) ? [{ time, stats: readPlayerStats(row.stats) }] : [];
  });
  return new Map(recentGames.map((game) => {
    const kickoff = Date.parse(game.date);
    const match = entries.filter((entry) => Number.isFinite(kickoff) && Math.abs(entry.time - kickoff) <= 36 * 3_600_000)
      .sort((first, second) => Math.abs(first.time - kickoff) - Math.abs(second.time - kickoff))[0];
    return [game.gameId, match?.stats ?? {}];
  }));
}
