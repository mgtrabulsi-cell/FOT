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

// --- Per-game details (player box stats + team statistics) ---

export type NFLGameDetailPlayer = { id: string; name: string; image: string | null; stats: Array<{ name: string; value: string | null }> };
export type NFLGameDetailTeam = {
  apiSportsId: string;
  name: string;
  groups: Array<{ name: string; players: NFLGameDetailPlayer[] }>;
  teamStats: Array<{ name: string; value: string }>;
};
export type NFLGameDetailPayload = {
  status: LiveFeedStatus;
  clock: string | null;
  period: number | null;
  away: NFLGameDetailTeam | null;
  home: NFLGameDetailTeam | null;
};

const teamStatLabels: Array<{ path: [string, string]; label: string }> = [
  { path: ['first_downs', 'total'], label: 'First downs' },
  { path: ['first_downs', 'third_down_efficiency'], label: '3rd down efficiency' },
  { path: ['first_downs', 'fourth_down_efficiency'], label: '4th down efficiency' },
  { path: ['plays', 'total'], label: 'Total plays' },
  { path: ['yards', 'total'], label: 'Total yards' },
  { path: ['yards', 'yards_per_play'], label: 'Yards per play' },
  { path: ['yards', 'total_drives'], label: 'Total drives' },
  { path: ['passing', 'total'], label: 'Passing yards' },
  { path: ['passing', 'comp_att'], label: 'Comp–Att' },
  { path: ['passing', 'yards_per_pass'], label: 'Yards per pass' },
  { path: ['passing', 'sacks_yards_lost'], label: 'Sacks–yards lost' },
  { path: ['rushings', 'total'], label: 'Rushing yards' },
  { path: ['rushings', 'attempts'], label: 'Rushing attempts' },
  { path: ['rushings', 'yards_per_rush'], label: 'Yards per rush' },
  { path: ['red_zone', 'made_att'], label: 'Red zone (made–att)' },
  { path: ['penalties', 'total'], label: 'Penalties' },
  { path: ['turnovers', 'total'], label: 'Turnovers' },
  { path: ['turnovers', 'lost_fumbles'], label: 'Fumbles lost' },
  { path: ['turnovers', 'interceptions'], label: 'Interceptions thrown' },
  { path: ['posession', 'total'], label: 'Possession' },
  { path: ['sacks', 'total'], label: 'Sacks' },
  { path: ['interceptions', 'total'], label: 'Interceptions' },
];

function detailTeam(side: unknown): { id: string; name: string } {
  const team = record(record(side).team);
  return { id: text(team.id), name: text(team.name) };
}

export function normalizeNFLGameDetails(
  game: Pick<LiveFeedGameRow, 'status' | 'clock' | 'period' | 'away_name' | 'home_name'>,
  playersPayload: unknown,
  teamsPayload: unknown,
): NFLGameDetailPayload {
  const playerEntries = readAPISportsResponse(playersPayload);
  const statsEntries = readAPISportsResponse(teamsPayload);
  const teams = new Map<string, NFLGameDetailTeam>();
  for (const entry of playerEntries) {
    const { id, name } = detailTeam(entry);
    if (!id || !name) continue;
    const groups = (Array.isArray(record(entry).groups) ? record(entry).groups as unknown[] : []).flatMap((groupValue) => {
      const group = record(groupValue);
      const groupName = text(group.name);
      const players = (Array.isArray(group.players) ? group.players : []).flatMap((playerValue): NFLGameDetailPlayer[] => {
        const player = record(playerValue);
        const identity = record(player.player);
        const playerId = text(identity.id), playerName = text(identity.name);
        if (!playerId || !playerName) return [];
        const stats = (Array.isArray(player.statistics) ? player.statistics : []).map((statValue) => {
          const stat = record(statValue);
          return { name: text(stat.name), value: stat.value === null || stat.value === undefined ? null : text(stat.value) };
        }).filter((stat) => stat.name);
        return [{ id: playerId, name: playerName, image: text(identity.image) || null, stats }];
      });
      return groupName && players.length ? [{ name: groupName, players }] : [];
    });
    teams.set(name, { apiSportsId: id, name, groups, teamStats: [] });
  }
  for (const entry of statsEntries) {
    const { name } = detailTeam(entry);
    const team = teams.get(name);
    if (!team) continue;
    const statistics = record(record(entry).statistics);
    team.teamStats = teamStatLabels.flatMap(({ path, label }) => {
      const value = record(statistics[path[0]])[path[1]];
      return value === null || value === undefined || text(value) === '' ? [] : [{ name: label, value: text(value) }];
    });
  }
  return {
    status: game.status, clock: game.clock, period: game.period,
    away: teams.get(game.away_name) ?? null,
    home: teams.get(game.home_name) ?? null,
  };
}

// Live games refresh their box stats about every three minutes; finals get one
// closing snapshot. Each target costs two API-Sports requests.
export function decideNFLDetailTargets(
  games: Array<Pick<LiveFeedGameRow, 'provider_game_id' | 'status'>>,
  details: Array<{ provider_game_id: string; status: string; fetched_at: string }>,
  now: Date,
  maxTargets: number,
): string[] {
  if (maxTargets <= 0) return [];
  const byId = new Map(details.map((detail) => [detail.provider_game_id, detail]));
  const live: Array<{ id: string; age: number }> = [];
  const finals: string[] = [];
  for (const game of games) {
    const detail = byId.get(game.provider_game_id);
    if (game.status === 'LIVE') {
      const age = detail ? now.getTime() - Date.parse(detail.fetched_at) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(age) || age >= 150_000) live.push({ id: game.provider_game_id, age });
    } else if (game.status === 'FINAL' && (!detail || detail.status !== 'FINAL')) {
      finals.push(game.provider_game_id);
    }
  }
  live.sort((first, second) => second.age - first.age);
  return [...live.map((game) => game.id), ...finals].slice(0, maxTargets);
}

// --- Season-long team game statistics (powers Team Comparison averages and ranks) ---

export type NFLSeasonFinal = {
  provider_game_id: string;
  game_date: string;
  home: { id: string; name: string; points: number | null };
  away: { id: string; name: string; points: number | null };
};

// Regular-season finals from the one-request full-season schedule.
export function readNFLSeasonFinals(payload: unknown): NFLSeasonFinal[] {
  return readAPISportsResponse(payload).flatMap((item): NFLSeasonFinal[] => {
    const entry = record(item);
    const game = record(entry.game);
    if (text(game.stage) !== 'Regular Season') return [];
    const status = text(record(game.status).short).toUpperCase();
    if (status !== 'FT' && status !== 'AOT') return [];
    const id = text(game.id), date = text(record(game.date).date);
    const teams = record(entry.teams), scores = record(entry.scores);
    const side = (key: 'home' | 'away') => ({
      id: text(record(teams[key]).id), name: text(record(teams[key]).name), points: num(record(scores[key]).total),
    });
    const home = side('home'), away = side('away');
    if (!id || !date || !home.id || !away.id) return [];
    return [{ provider_game_id: id, game_date: date, home, away }];
  });
}

export type NFLTeamGameRow = {
  sport: 'NFL';
  season: number;
  provider_game_id: string;
  api_team_id: string;
  espn_team_id: string | null;
  team_name: string;
  game_date: string;
  points_for: number | null;
  points_against: number | null;
  yards: number | null;
  pass_yards: number | null;
  rush_yards: number | null;
  yards_against: number | null;
  pass_yards_against: number | null;
  rush_yards_against: number | null;
};

// Two per-team rows for one final, pairing each side's yardage with its opponent's.
export function normalizeNFLTeamGame(
  season: number,
  final: NFLSeasonFinal,
  teamsStatsPayload: unknown,
  espnIdFor: (apiTeamId: string) => string | null,
): NFLTeamGameRow[] {
  const stats = new Map(readAPISportsResponse(teamsStatsPayload).map((item) => {
    const entry = record(item);
    const statistics = record(entry.statistics);
    return [text(record(entry.team).id), {
      yards: num(record(statistics.yards).total),
      pass_yards: num(record(statistics.passing).total),
      rush_yards: num(record(statistics.rushings).total),
    }];
  }));
  const sides = [
    { own: final.home, opponent: final.away },
    { own: final.away, opponent: final.home },
  ];
  return sides.flatMap((side): NFLTeamGameRow[] => {
    const own = stats.get(side.own.id), opponent = stats.get(side.opponent.id);
    if (!own || !opponent) return [];
    return [{
      sport: 'NFL', season,
      provider_game_id: final.provider_game_id,
      api_team_id: side.own.id,
      espn_team_id: espnIdFor(side.own.id),
      team_name: side.own.name,
      game_date: final.game_date,
      points_for: side.own.points, points_against: side.opponent.points,
      yards: own.yards, pass_yards: own.pass_yards, rush_yards: own.rush_yards,
      yards_against: opponent.yards, pass_yards_against: opponent.pass_yards, rush_yards_against: opponent.rush_yards,
    }];
  });
}

// --- Per-player game statistics (player game logs) ---

export type NFLPlayerGameRow = {
  sport: 'NFL';
  season: number;
  provider_game_id: string;
  api_player_id: string;
  api_team_id: string;
  name: string;
  game_date: string;
  stats: Record<string, number>;
};

// A sentinel row marks a game as player-synced even when no skill stats were recorded.
export const playerGamesSyncMarker = 'game';

function parseStatNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Mirrors the ESPN box-score extraction exactly: the same stat keys the player
// dialog charts, computed from API-Sports Passing/Rushing/Receiving groups.
export function normalizeNFLPlayerGames(season: number, final: NFLSeasonFinal, playersPayload: unknown): NFLPlayerGameRow[] {
  const merged = new Map<string, NFLPlayerGameRow>();
  for (const item of readAPISportsResponse(playersPayload)) {
    const entry = record(item);
    const teamId = text(record(entry.team).id);
    if (!teamId) continue;
    for (const groupValue of Array.isArray(entry.groups) ? entry.groups : []) {
      const group = record(groupValue);
      const groupName = text(group.name).toLowerCase();
      if (groupName !== 'passing' && groupName !== 'rushing' && groupName !== 'receiving') continue;
      for (const playerValue of Array.isArray(group.players) ? group.players : []) {
        const player = record(playerValue);
        const identity = record(player.player);
        const playerId = text(identity.id), name = text(identity.name);
        if (!playerId || !name) continue;
        const statOf = (statName: string): string | null => {
          for (const statValue of Array.isArray(player.statistics) ? player.statistics : []) {
            const stat = record(statValue);
            if (text(stat.name) === statName) return stat.value === null || stat.value === undefined ? null : text(stat.value);
          }
          return null;
        };
        const row = merged.get(playerId) ?? {
          sport: 'NFL' as const, season, provider_game_id: final.provider_game_id,
          api_player_id: playerId, api_team_id: teamId, name, game_date: final.game_date, stats: {},
        };
        if (groupName === 'passing') {
          const completionAttempt = (statOf('comp att') ?? '').match(/([\d,]+)\s*\/\s*([\d,]+)/);
          if (completionAttempt) {
            row.stats.completions = Number.parseInt(completionAttempt[1].replace(/,/g, ''), 10);
            row.stats.attempts = Number.parseInt(completionAttempt[2].replace(/,/g, ''), 10);
          }
          const yards = parseStatNumber(statOf('yards')), touchdowns = parseStatNumber(statOf('passing touch downs'));
          const interceptions = parseStatNumber(statOf('interceptions'));
          if (yards !== undefined) row.stats.passingYards = yards;
          if (touchdowns !== undefined) row.stats.passingTouchdowns = touchdowns;
          if (interceptions !== undefined) row.stats.interceptions = interceptions;
        } else if (groupName === 'rushing') {
          const carries = parseStatNumber(statOf('total rushes')), yards = parseStatNumber(statOf('yards'));
          const touchdowns = parseStatNumber(statOf('rushing touch downs'));
          if (carries !== undefined) row.stats.carries = carries;
          if (yards !== undefined) row.stats.rushingYards = yards;
          if (touchdowns !== undefined) row.stats.rushingTouchdowns = touchdowns;
        } else {
          const receptions = parseStatNumber(statOf('total receptions')), targets = parseStatNumber(statOf('targets'));
          const yards = parseStatNumber(statOf('yards')), touchdowns = parseStatNumber(statOf('receiving touch downs'));
          if (receptions !== undefined) row.stats.receptions = receptions;
          if (targets !== undefined) row.stats.targets = targets;
          if (yards !== undefined) row.stats.receivingYards = yards;
          if (touchdowns !== undefined) row.stats.receivingTouchdowns = touchdowns;
        }
        merged.set(playerId, row);
      }
    }
  }
  const rows = [...merged.values()].filter((row) => Object.keys(row.stats).length > 0);
  for (const row of rows) {
    const yards = [row.stats.passingYards, row.stats.rushingYards, row.stats.receivingYards]
      .filter((value): value is number => value !== undefined);
    if (yards.length > 0) row.stats.totalYards = yards.reduce((total, value) => total + value, 0);
  }
  rows.push({
    sport: 'NFL', season, provider_game_id: final.provider_game_id,
    api_player_id: playerGamesSyncMarker, api_team_id: playerGamesSyncMarker,
    name: 'Synced game marker', game_date: final.game_date, stats: {},
  });
  return rows;
}

// --- Push poller integration ---

// Matches API-Sports rows to ESPN scoreboard events by mapped team IDs and kickoff time.
export function matchESPNEventIds(
  rows: Array<Pick<LiveFeedGameRow, 'provider_game_id' | 'start_time' | 'away_name' | 'home_name'>>,
  scoreboardPayload: unknown,
  espnTeamIdFor: (teamName: string) => string | null,
): Array<{ provider_game_id: string; espn_event_id: string }> {
  const events = Array.isArray(record(scoreboardPayload).events) ? record(scoreboardPayload).events as unknown[] : [];
  const index = new Map<string, Array<{ id: string; start: number }>>();
  for (const value of events) {
    const event = record(value);
    const id = text(event.id), start = Date.parse(text(event.date));
    const competitors = (Array.isArray(record((record(event).competitions as unknown[] ?? [])[0]).competitors)
      ? record((record(event).competitions as unknown[])[0]).competitors as unknown[] : []).map(record);
    const away = competitors.find((entry) => text(entry.homeAway) === 'away');
    const home = competitors.find((entry) => text(entry.homeAway) === 'home');
    const awayId = text(record(away?.team).id), homeId = text(record(home?.team).id);
    if (!id || !awayId || !homeId || !Number.isFinite(start)) continue;
    const key = `${awayId}@${homeId}`;
    index.set(key, [...(index.get(key) ?? []), { id, start }]);
  }
  return rows.flatMap((row) => {
    const awayId = espnTeamIdFor(row.away_name), homeId = espnTeamIdFor(row.home_name);
    if (!awayId || !homeId) return [];
    const start = Date.parse(row.start_time);
    const match = (index.get(`${awayId}@${homeId}`) ?? [])
      .find((event) => Number.isFinite(start) && Math.abs(event.start - start) <= 6 * 3_600_000);
    return match ? [{ provider_game_id: row.provider_game_id, espn_event_id: match.id }] : [];
  });
}

export type PushFeedGame = {
  id: string;
  away: { id: string; abbreviation: string; score: number };
  home: { id: string; abbreviation: string; score: number };
  state: string;
  period: number;
  clock: string;
  lastPlayText: string;
};

// Converts fresh live-feed rows into the shape the push poller's state machine
// expects. Returns null — demanding the ESPN scoreboard fallback — when there are
// no rows or when any live game is unlinked or stale, so notifications never
// silently skip an active game.
export function pushGamesFromFeed(
  rows: Array<Pick<LiveFeedGameRow, 'status' | 'away_name' | 'home_name' | 'away_score' | 'home_score' | 'period' | 'clock'>
    & { espn_event_id: string | null; fetched_at: string }>,
  teamFor: (teamName: string) => { espnId: string; espnAbbr: string } | null,
  now: Date,
): PushFeedGame[] | null {
  if (!rows.length) return null;
  const games: PushFeedGame[] = [];
  for (const row of rows) {
    const fresh = Number.isFinite(Date.parse(row.fetched_at)) && now.getTime() - Date.parse(row.fetched_at) <= 150_000;
    const away = teamFor(row.away_name), home = teamFor(row.home_name);
    const usable = row.espn_event_id && fresh && away && home;
    if (!usable) {
      if (row.status === 'LIVE') return null;
      continue;
    }
    games.push({
      id: row.espn_event_id as string,
      away: { id: away.espnId, abbreviation: away.espnAbbr, score: row.away_score ?? 0 },
      home: { id: home.espnId, abbreviation: home.espnAbbr, score: row.home_score ?? 0 },
      state: row.status === 'LIVE' ? 'in' : row.status === 'FINAL' ? 'post' : 'pre',
      period: row.period ?? 0,
      clock: row.clock ?? '',
      lastPlayText: '',
    });
  }
  return games.length ? games : null;
}
