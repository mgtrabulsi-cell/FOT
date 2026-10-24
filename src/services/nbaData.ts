import type { FavoriteTarget, Game, NFLFavoritePlay, Team } from './sportsData.ts';

export type NBAPlayerStatKey = 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers' | 'minutes' | 'offensiveRebounds' | 'defensiveRebounds' | 'fouls' | 'threePointersMade' | 'fieldGoalsMade' | 'fieldGoalsAttempted' | 'threePointersAttempted' | 'freeThrowsMade' | 'freeThrowsAttempted' | 'fieldGoalPct' | 'threePointPct' | 'freeThrowPct' | 'plusMinus';
export type NBAStats = Partial<Record<NBAPlayerStatKey, number>>;
export type NBAPlayer = { id: string; name: string; position: string; jersey: string; headshot?: string; teamId: string };
export type NBABoxPlayer = NBAPlayer & { stats: NBAStats; display: Record<string, string>; didNotPlay: boolean; reason: string; starter: boolean };
export type NBATeamStat = { name: string; label: string; display: string };
export type NBABoxTeam = { id: string; players: NBABoxPlayer[]; stats: NBATeamStat[] };
export type NBAPlay = { id: string; sequence?: number; text: string; period: number; periodLabel: string; clock: string; awayScore?: number; homeScore?: number; scoring: boolean; teamId: string; playerIds: string[]; timestamp: string };
export type NBASummary = { eventId: string; teams: NBABoxTeam[]; plays: NBAPlay[]; clock: string; period: string; status: string; awayScore?: number; homeScore?: number };
export type NBAPlayerGame = { id: string; date: string; opponent: string; atVs?: string; display?: Record<string, string>; result: string; score: string; seasonType: string; stats: NBAStats };
export type NBAPlayerProfile = { season: number; gamesPlayed?: number; totals: NBAStats; averages: NBAStats; games: NBAPlayerGame[] };
export const nbaStatOptions: Array<{ key: NBAPlayerStatKey; label: string }> = [
  { key: 'points', label: 'Points' }, { key: 'rebounds', label: 'Rebounds' }, { key: 'assists', label: 'Assists' },
  { key: 'steals', label: 'Steals' }, { key: 'blocks', label: 'Blocks' }, { key: 'turnovers', label: 'Turnovers' },
  { key: 'minutes', label: 'Minutes' }, { key: 'threePointersMade', label: '3PT made' },
  { key: 'offensiveRebounds', label: 'Offensive rebounds' }, { key: 'defensiveRebounds', label: 'Defensive rebounds' },
  { key: 'fouls', label: 'Fouls' }, { key: 'fieldGoalPct', label: 'FG%' }, { key: 'threePointPct', label: '3PT%' }, { key: 'freeThrowPct', label: 'FT%' },
];

const base = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const athleteBase = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function obj(value: unknown): Record<string, unknown> { return isObject(value) ? value : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string { return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''; }
export function nbaNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim().replace(/%$/, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function minutes(value: unknown) {
  if (typeof value === 'string' && /^\d+:\d{2}$/.test(value)) {
    const [min, sec] = value.split(':').map(Number);
    return sec < 60 ? min + sec / 60 : undefined;
  }
  return nbaNumber(value);
}
const statNames: Record<string, NBAPlayerStatKey> = {
  PTS: 'points', points: 'points', avgPoints: 'points', REB: 'rebounds', totalRebounds: 'rebounds', rebounds: 'rebounds', avgRebounds: 'rebounds',
  AST: 'assists', assists: 'assists', avgAssists: 'assists', STL: 'steals', steals: 'steals', avgSteals: 'steals',
  BLK: 'blocks', blocks: 'blocks', avgBlocks: 'blocks', TO: 'turnovers', turnovers: 'turnovers', avgTurnovers: 'turnovers',
  MIN: 'minutes', minutes: 'minutes', avgMinutes: 'minutes', OREB: 'offensiveRebounds', offensiveRebounds: 'offensiveRebounds', avgOffensiveRebounds: 'offensiveRebounds',
  DREB: 'defensiveRebounds', defensiveRebounds: 'defensiveRebounds', avgDefensiveRebounds: 'defensiveRebounds',
  PF: 'fouls', fouls: 'fouls', avgFouls: 'fouls', '+/-': 'plusMinus', plusMinus: 'plusMinus',
  fieldGoalPct: 'fieldGoalPct', 'FG%': 'fieldGoalPct', threePointPct: 'threePointPct', threePointFieldGoalPct: 'threePointPct', '3P%': 'threePointPct', '3PT%': 'threePointPct',
  freeThrowPct: 'freeThrowPct', 'FT%': 'freeThrowPct',
  fieldGoalsMade: 'fieldGoalsMade', fieldGoalsAttempted: 'fieldGoalsAttempted',
  threePointFieldGoalsMade: 'threePointersMade', threePointFieldGoalsAttempted: 'threePointersAttempted',
  freeThrowsMade: 'freeThrowsMade', freeThrowsAttempted: 'freeThrowsAttempted',
};
const pairs: Record<string, [NBAPlayerStatKey, NBAPlayerStatKey]> = {
  FG: ['fieldGoalsMade', 'fieldGoalsAttempted'], 'fieldGoalsMade-fieldGoalsAttempted': ['fieldGoalsMade', 'fieldGoalsAttempted'],
  'avgFieldGoalsMade-avgFieldGoalsAttempted': ['fieldGoalsMade', 'fieldGoalsAttempted'],
  '3PT': ['threePointersMade', 'threePointersAttempted'], 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': ['threePointersMade', 'threePointersAttempted'],
  'avgThreePointFieldGoalsMade-avgThreePointFieldGoalsAttempted': ['threePointersMade', 'threePointersAttempted'],
  FT: ['freeThrowsMade', 'freeThrowsAttempted'], 'freeThrowsMade-freeThrowsAttempted': ['freeThrowsMade', 'freeThrowsAttempted'],
  'avgFreeThrowsMade-avgFreeThrowsAttempted': ['freeThrowsMade', 'freeThrowsAttempted'],
};
export function parseNBAStatRow(names: unknown, values: unknown): NBAStats {
  const stats: NBAStats = {};
  const row = list(values);
  list(names).forEach((raw, index) => {
    const name = str(raw);
    const pair = pairs[name];
    if (pair) {
      const match = str(row[index]).match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (match) { stats[pair[0]] = Number(match[1]); stats[pair[1]] = Number(match[2]); }
    } else {
      const key = statNames[name];
      const value = key === 'minutes' ? minutes(row[index]) : nbaNumber(row[index]);
      if (key && value !== undefined) stats[key] = value;
    }
  });
  return stats;
}
function readPlayer(value: unknown, teamId: string): NBAPlayer | null {
  const player = obj(value);
  const id = str(player.id);
  const name = str(player.displayName) || str(player.fullName);
  if (!id || !name) return null;
  return { id, name, teamId, position: str(obj(player.position).abbreviation), jersey: str(player.jersey), headshot: str(obj(player.headshot).href) || undefined };
}
export function parseNBARoster(value: unknown, teamId: string): NBAPlayer[] {
  const data = obj(value);
  if (!Array.isArray(data.athletes)) throw new Error('NBA roster data is unavailable or malformed.');
  const players = data.athletes.flatMap((entry) => {
    const group = obj(entry);
    return Array.isArray(group.items) ? group.items : [entry];
  }).map((entry) => readPlayer(entry, teamId)).filter((entry): entry is NBAPlayer => entry !== null);
  return [...new Map(players.map((player) => [player.id, player])).values()];
}
export function parseNBATeams(value: unknown): Team[] {
  const sports = list(obj(value).sports);
  const entries = list(obj(list(obj(sports[0]).leagues)[0]).teams);
  if (!Array.isArray(obj(list(obj(sports[0]).leagues)[0]).teams)) throw new Error('NBA team data is unavailable or malformed.');
  return entries.flatMap((entry): Team[] => {
    const team = obj(obj(entry).team);
    if (!str(team.id) || !str(team.displayName)) return [];
    return [{ id: str(team.id), name: str(team.displayName), abbr: str(team.abbreviation), color: str(team.color), logo: str(obj(list(team.logos)[0]).href) || undefined, score: 0, record: '' }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function parseNBAPlays(value: unknown): NBAPlay[] {
  const data = obj(value);
  const source = Array.isArray(data.plays) ? data.plays : list(data.scoringPlays);
  const seen = new Set<string>();
  return source.flatMap((entry): NBAPlay[] => {
    const play = obj(entry);
    const id = str(play.id);
    const text = str(play.text);
    if (!id || !text || seen.has(id)) return [];
    seen.add(id);
    const period = obj(play.period);
    return [{
      id, sequence: nbaNumber(play.sequenceNumber), text, period: nbaNumber(period.number) ?? 0, periodLabel: str(period.displayValue),
      clock: str(obj(play.clock).displayValue), awayScore: nbaNumber(play.awayScore), homeScore: nbaNumber(play.homeScore),
      scoring: play.scoringPlay === true || (nbaNumber(play.scoreValue) ?? 0) > 0, teamId: str(obj(play.team).id),
      playerIds: list(play.participants).map((participant) => str(obj(obj(participant).athlete).id)).filter(Boolean),
      timestamp: str(play.wallclock) || str(play.modified),
    }];
  }).sort((a, b) => {
    if (a.period !== b.period) return a.period - b.period;
    const remaining = (clock: string) => {
      const match = clock.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
      if (match) return Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : undefined;
      return /^\d+(?:\.\d+)?$/.test(clock) ? Number(clock) : undefined;
    };
    const ac = remaining(a.clock), bc = remaining(b.clock);
    // ESPN can append earlier-clock corrections after the end-of-game sequence.
    if (ac !== undefined && bc !== undefined && ac !== bc) return bc - ac;
    return a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : 0;
  });
}
export function parseNBASummary(value: unknown, eventId: string): NBASummary {
  const data = obj(value);
  if (!isObject(data.header) && !isObject(data.boxscore)) throw new Error('NBA game details are unavailable or malformed.');
  const box = obj(data.boxscore);
  const teams = new Map<string, NBABoxTeam>();
  for (const raw of list(box.teams)) {
    const entry = obj(raw), teamId = str(obj(entry.team).id);
    if (!teamId) continue;
    teams.set(teamId, { id: teamId, players: [], stats: list(entry.statistics).flatMap((rawStat): NBATeamStat[] => {
      const stat = obj(rawStat);
      return str(stat.name) ? [{ name: str(stat.name), label: str(stat.label) || str(stat.abbreviation) || str(stat.name), display: str(stat.displayValue) || '—' }] : [];
    }) });
  }
  for (const raw of list(box.players)) {
    const entry = obj(raw), teamId = str(obj(entry.team).id);
    if (!teamId) continue;
    const team = teams.get(teamId) ?? { id: teamId, players: [], stats: [] };
    for (const rawCategory of list(entry.statistics)) {
      const category = obj(rawCategory), names = list(category.names).length ? category.names : category.labels;
      for (const rawRow of list(category.athletes)) {
        const row = obj(rawRow), player = readPlayer(row.athlete, teamId);
        if (!player) continue;
        const didNotPlay = row.didNotPlay === true;
        const display: Record<string, string> = {};
        list(names).forEach((key, index) => { display[str(key)] = didNotPlay ? 'DNP' : str(list(row.stats)[index]) || '—'; });
        team.players.push({ ...player, stats: didNotPlay ? {} : parseNBAStatRow(names, row.stats), display, didNotPlay, reason: str(row.reason), starter: row.starter === true });
      }
    }
    team.players = [...new Map(team.players.map((player) => [player.id, player])).values()];
    teams.set(teamId, team);
  }
  const competition = obj(list(obj(data.header).competitions)[0]), status = obj(competition.status);
  const competitors = list(competition.competitors).map(obj);
  const periodNumber = nbaNumber(status.period);
  const period = str(obj(status.type).name) === 'STATUS_HALFTIME' ? 'Halftime' : periodNumber !== undefined && periodNumber > 0 ? periodNumber <= 4 ? `Q${periodNumber}` : `OT${periodNumber - 4}` : str(obj(status.type).shortDetail);
  return { eventId, teams: [...teams.values()], plays: parseNBAPlays(data), clock: str(status.displayClock), period, status: str(obj(status.type).state),
    awayScore: nbaNumber(competitors.find((team) => team.homeAway === 'away')?.score), homeScore: nbaNumber(competitors.find((team) => team.homeAway === 'home')?.score) };
}
export function parseNBATeamSeason(value: unknown): NBATeamStat[] {
  const data = obj(value), stats = obj(obj(data.results).stats);
  if (!Array.isArray(stats.categories)) throw new Error('NBA team season statistics are unavailable or malformed.');
  const wanted = new Set(['gamesPlayed', 'avgPoints', 'avgRebounds', 'avgAssists', 'avgSteals', 'avgBlocks', 'avgTurnovers', 'fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct']);
  return list(stats.categories).flatMap((category) => list(obj(category).stats)).flatMap((entry): NBATeamStat[] => {
    const stat = obj(entry), name = str(stat.name);
    return wanted.has(name) ? [{ name, label: str(stat.displayName) || name, display: nbaNumber(stat.value) === undefined ? '—' : str(stat.displayValue) || String(stat.value) }] : [];
  });
}
export function parseNBAPlayerSeason(value: unknown, season: number): Omit<NBAPlayerProfile, 'games'> {
  const data = obj(value);
  if (!Array.isArray(data.categories)) throw new Error('NBA player season statistics are unavailable or malformed.');
  let totals: NBAStats = {}, averages: NBAStats = {}, gamesPlayed: number | undefined;
  for (const raw of data.categories) {
    const category = obj(raw);
    if (category.name !== 'averages' && category.name !== 'totals') continue;
    const rows = list(category.statistics).map(obj).filter((row) => nbaNumber(obj(row.season).year) === season);
    // A combined traded-player row already includes every team stint.
    const combined = rows.find((row) => ['0', '-1', 'TOT'].includes(str(row.teamId)) || (!row.teamId && rows.length > 1));
    const selected = combined ? [combined] : rows;
    if (category.name === 'totals') {
      const parsed = selected.map((row) => parseNBAStatRow(category.names, row.stats));
      if (parsed.length === 1) totals = parsed[0];
      else if (parsed.length > 1) {
        for (const option of Object.values(statNames)) {
          if (option.endsWith('Pct') || option === 'plusMinus') continue;
          if (parsed.every((row) => row[option] !== undefined)) totals[option] = parsed.reduce((sum, row) => sum + (row[option] ?? 0), 0);
        }
        for (const [key, made, attempted] of [
          ['fieldGoalPct', 'fieldGoalsMade', 'fieldGoalsAttempted'], ['threePointPct', 'threePointersMade', 'threePointersAttempted'], ['freeThrowPct', 'freeThrowsMade', 'freeThrowsAttempted'],
        ] satisfies Array<[NBAPlayerStatKey, NBAPlayerStatKey, NBAPlayerStatKey]>) {
          if (totals[made] !== undefined && totals[attempted] !== undefined && totals[attempted] !== 0) totals[key] = totals[made]! / totals[attempted]! * 100;
        }
      }
    } else if (selected.length) {
      const names = list(category.names).map(str), gpIndex = names.indexOf('gamesPlayed');
      const counts = selected.map((row) => nbaNumber(list(row.stats)[gpIndex]));
      if (counts.every((count) => count !== undefined)) gamesPlayed = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
      const parsed = selected.map((row) => parseNBAStatRow(category.names, row.stats));
      if (parsed.length === 1) averages = parsed[0];
      else if (gamesPlayed !== undefined && gamesPlayed > 0) {
        for (const key of Object.values(statNames)) {
          if (!key.endsWith('Pct') && parsed.every((row) => row[key] !== undefined)) averages[key] = parsed.reduce((sum, row, index) => sum + (row[key] ?? 0) * (counts[index] ?? 0), 0) / gamesPlayed;
        }
      }
    }
  }
  if (gamesPlayed !== undefined && gamesPlayed > 0) {
    for (const key of Object.values(statNames)) {
      const total = totals[key];
      if (total !== undefined && !key.endsWith('Pct') && key !== 'plusMinus') averages[key] = total / gamesPlayed;
      if (key.endsWith('Pct') && total !== undefined) averages[key] = total;
    }
  }
  return { season, gamesPlayed, totals, averages };
}
export function parseNBAPlayerGames(value: unknown): NBAPlayerGame[] {
  const data = obj(value);
  if (!Array.isArray(data.seasonTypes) || !isObject(data.events)) throw new Error('NBA player game logs are unavailable or malformed.');
  const events = data.events, result: NBAPlayerGame[] = [], seen = new Set<string>();
  for (const seasonType of data.seasonTypes) {
    for (const category of list(obj(seasonType).categories)) {
      for (const raw of list(obj(category).events)) {
        const row = obj(raw), id = str(row.eventId), event = obj(events[id]);
        if (!id || seen.has(id) || !str(event.gameDate)) continue;
        seen.add(id);
        const display: Record<string, string> = {};
        list(data.names).forEach((name, index) => {
          const value = str(list(row.stats)[index]);
          if (name === 'minutes') display.MIN = value;
          if (name === 'fieldGoalsMade-fieldGoalsAttempted') display.FG = value;
          if (name === 'threePointFieldGoalsMade-threePointFieldGoalsAttempted') display['3PT'] = value;
          if (name === 'freeThrowsMade-freeThrowsAttempted') display.FT = value;
        });
        result.push({ id, date: str(event.gameDate), opponent: str(obj(event.opponent).abbreviation) || str(obj(event.opponent).displayName), atVs: ['@', 'vs'].includes(str(event.atVs)) ? str(event.atVs) : undefined, display, result: str(event.gameResult), score: str(event.score), seasonType: str(obj(seasonType).displayName), stats: parseNBAStatRow(data.names, row.stats) });
      }
    }
  }
  return result.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
async function get(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`NBA data feed returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (!isObject(data)) throw new Error('NBA data feed returned a malformed response.');
  return data;
}
export async function fetchNBATeams(signal?: AbortSignal) { return parseNBATeams(await get(`${base}/teams?limit=100`, signal)); }
export async function fetchNBALeague(signal?: AbortSignal): Promise<{ teams: Team[]; season: number }> {
  const data = await get(`${base}/teams?limit=100`, signal);
  const league = obj(list(obj(list(obj(data).sports)[0]).leagues)[0]);
  const season = nbaNumber(obj(league.season).year) ?? nbaNumber(league.year);
  if (season === undefined) throw new Error('NBA season data is unavailable.');
  return { teams: parseNBATeams(data), season };
}
export async function fetchNBARoster(teamId: string, season: number, signal?: AbortSignal) { return parseNBARoster(await get(`${base}/teams/${encodeURIComponent(teamId)}/roster?season=${season}`, signal), teamId); }
export async function fetchNBASummary(eventId: string, signal?: AbortSignal) { return parseNBASummary(await get(`${base}/summary?event=${encodeURIComponent(eventId)}`, signal), eventId); }
export async function fetchNBATeamSeason(teamId: string, season: number, signal?: AbortSignal) { return parseNBATeamSeason(await get(`${base}/teams/${encodeURIComponent(teamId)}/statistics?season=${season}&seasontype=2`, signal)); }
export async function fetchNBAPlayerSeason(playerId: string, season: number, signal?: AbortSignal) {
  return parseNBAPlayerSeason(await get(`${athleteBase}/${encodeURIComponent(playerId)}/stats?season=${season}&seasontype=2`, signal), season);
}
export async function fetchNBAPointsPerGame(players: NBAPlayer[], season: number, signal?: AbortSignal) {
  const averages: Record<string, number> = {};
  const failed: string[] = [];
  const unique = [...new Map(players.map((player) => [player.id, player])).values()];
  for (let start = 0; start < unique.length; start += 4) {
    signal?.throwIfAborted();
    await Promise.all(unique.slice(start, start + 4).map(async (player) => {
      try {
        const value = (await fetchNBAPlayerSeason(player.id, season, signal)).averages.points;
        if (value !== undefined) averages[player.id] = value;
      } catch (error) {
        if (signal?.aborted) throw error;
        console.error(`Could not load NBA scoring average for ${player.id}`, error);
        failed.push(player.id);
      }
    }));
  }
  return { averages, failed, updatedAt: Date.now() };
}
export async function fetchNBAPlayerProfile(playerId: string, season: number, signal?: AbortSignal): Promise<NBAPlayerProfile> {
  const path = `${athleteBase}/${encodeURIComponent(playerId)}`;
  const [stats, games] = await Promise.all([fetchNBAPlayerSeason(playerId, season, signal), get(`${path}/gamelog?season=${season}`, signal)]);
  return { ...stats, games: parseNBAPlayerGames(games) };
}
export async function fetchNBALivePlayerStats(eventId: string, players: Array<{ teamId: string; id: string }>, signal?: AbortSignal): Promise<Record<string, Partial<Record<NBAPlayerStatKey, number>>>> {
  const summary = await fetchNBASummary(eventId, signal), result: Record<string, NBAStats> = {};
  for (const target of players) {
    const player = summary.teams.find((team) => team.id === target.teamId)?.players.find((entry) => entry.id === target.id);
    if (player && !player.didNotPlay) result[target.id] = player.stats;
  }
  return result;
}
export function nbaTeamFavorite(team: Team): FavoriteTarget {
  return { key: `team:basketball/nba:${team.id}`, type: 'team', id: team.id, name: team.name, shortName: team.abbr, feedPath: 'basketball/nba', teamId: team.id, teamName: team.name, teamAbbr: team.abbr, logo: team.logo };
}
export function nbaPlayerFavorite(player: NBAPlayer, team: Team): FavoriteTarget {
  return { key: `player:basketball/nba:${player.id}`, type: 'player', id: player.id, name: player.name, shortName: player.name, feedPath: 'basketball/nba', teamId: team.id, teamName: team.name, teamAbbr: team.abbr, position: player.position, headshot: player.headshot, logo: team.logo };
}
export function nbaFavoritePlays(game: Game, summary: NBASummary, favorites: FavoriteTarget[]): NFLFavoritePlay[] {
  return summary.plays.filter((play) => play.scoring).flatMap((play) => favorites.flatMap((favorite): NFLFavoritePlay[] => {
    if (favorite.feedPath !== 'basketball/nba') return [];
    const teamId = favorite.type === 'team' ? favorite.id : favorite.teamId;
    const team = [game.away, game.home].find((entry) => entry.id === teamId);
    if (!team || (favorite.type === 'team' ? play.teamId !== team.id : !play.playerIds.includes(favorite.id))) return [];
    const opponent = team.id === game.home.id ? game.away : game.home;
    const timestamp = Number.isFinite(Date.parse(play.timestamp)) ? play.timestamp : game.date;
    return [{ id: `nba:${game.eventId}:${play.id}:${favorite.key}`, favoriteKey: favorite.key, favoriteName: favorite.name, favoriteType: favorite.type,
      headshot: favorite.headshot, teamLogo: team.logo, teamAbbr: team.abbr, opponentAbbr: opponent.abbr, timestamp, playLabel: play.text,
      description: `${play.periodLabel || (play.period ? `Period ${play.period}` : '')} ${play.clock} · ${play.text}${play.awayScore !== undefined && play.homeScore !== undefined ? ` · ${game.away.abbr} ${play.awayScore}–${play.homeScore} ${game.home.abbr}` : ''}`,
      yards: 0, isTouchdown: false, isDefensive: false }];
  }));
}
export async function fetchNBAFavoritePlays(games: Game[], favorites: FavoriteTarget[], signal?: AbortSignal): Promise<NFLFavoritePlay[]> {
  const nbaFavorites = favorites.filter((favorite) => favorite.feedPath === 'basketball/nba');
  const relevant = games.filter((game) => game.feedPath === 'basketball/nba' && game.status !== 'UPCOMING' && nbaFavorites.some((favorite) =>
    [game.away.id, game.home.id].includes(favorite.type === 'team' ? favorite.id : favorite.teamId ?? '')));
  return (await Promise.all(relevant.map(async (game) => nbaFavoritePlays(game, await fetchNBASummary(game.eventId, signal), nbaFavorites)))).flat();
}
