import { mapEvent, readTeam } from './sportsData.ts';
import type { Game, Team } from './sportsData.ts';
import { readRenderSnapshot, saveRenderSnapshot } from './renderSnapshots.ts';
import { fetchStaticSports } from './sportsDatabase.ts';

export type TeamLogLeague = 'NBA' | 'NFL';
export type TeamLogEntry = { game: Game; seasonType: 1 | 2 | 3 };
export type TeamLogDirectory = { teams: Team[]; season: number };
const base = 'https://site.api.espn.com/apis/site/v2/sports';
const path = (league: TeamLogLeague) => league === 'NBA' ? 'basketball/nba' : 'football/nfl';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export const teamLogKey = (league: TeamLogLeague, teamId: string, season: number) => `${league}:${teamId}:${season}`;
export const teamSeasonLabel = (league: TeamLogLeague, season: number) => league === 'NBA' ? `${season - 1}-${String(season).slice(-2)}` : String(season);
export const teamLogResult = (game: Game, teamId: string) => {
  const own = game.home.id === teamId ? game.home : game.away;
  const opponent = game.home.id === teamId ? game.away : game.home;
  return own.score > opponent.score ? 'W' : own.score < opponent.score ? 'L' : 'T';
};

export function parseTeamLogDirectory(payload: unknown): TeamLogDirectory {
  const league = object(list(object(list(object(payload).sports)[0]).leagues)[0]);
  const season = Number(object(league.season).year ?? league.year);
  if (!Array.isArray(league.teams) || !Number.isInteger(season) || season < 2002)
    throw new Error('Team directory or current season is unavailable.');
  if (league.teams.some(entry => !text(object(object(entry).team).displayName) || !text(object(object(entry).team).abbreviation)))
    throw new Error('Team directory returned incomplete team identities.');
  const teams = league.teams.map(readTeam);
  if (!teams.length || teams.some(team => !/^\d+$/.test(team.id) || !team.name || !team.abbr))
    throw new Error('Team directory returned incomplete teams.');
  return { teams: [...new Map(teams.map(team => [team.id, team])).values()].sort((a, b) => a.name.localeCompare(b.name)), season };
}

export function parseTeamGameLog(payload: unknown, league: TeamLogLeague, teamId: string, season: number, seasonType: 1 | 2 | 3, now = Date.now()): TeamLogEntry[] {
  const data = object(payload), seasonData = object(data.requestedSeason ?? data.season);
  if (!Array.isArray(data.events) || text(object(data.team).id) !== teamId || Number(seasonData.year) !== season)
    throw new Error('Team schedule returned a different team, season, or malformed game list.');
  if (data.events.length && Number(seasonData.type) !== seasonType)
    throw new Error('Team schedule returned the wrong season phase.');
  const games: TeamLogEntry[] = [];
  for (const raw of data.events) {
    const event = object(raw), competition = object(list(event.competitions)[0]);
    if ((event.season !== undefined && Number(object(event.season).year) !== season)
      || (event.seasonType !== undefined && Number(object(event.seasonType).type) !== seasonType))
      throw new Error('A scheduled game belongs to a different season or phase.');
    const status = object(competition.status ?? event.status), statusType = object(status.type);
    if (statusType.completed !== true || statusType.state !== 'post' || /cancel|postpon|suspend|abandon/i.test(text(statusType.name))) continue;
    const date = text(event.date ?? competition.date);
    if (!Number.isFinite(Date.parse(date))) throw new Error('A completed game has no valid date.');
    if (Date.parse(date) > now) continue;
    const competitors = list(competition.competitors).map(object);
    if (competitors.length !== 2 || !competitors.some(row => text(object(row.team).id) === teamId))
      throw new Error('Completed game does not match the selected team.');
    const normalized = competitors.map(row => {
      if (!/^\d+$/.test(text(object(row.team).id)) || !text(object(row.team).displayName) || !text(object(row.team).abbreviation))
        throw new Error('A completed game has no verified team identity.');
      const score = typeof row.score === 'object' ? object(row.score).value ?? object(row.score).displayValue : row.score;
      if (score === '' || score === undefined || score === null || !Number.isInteger(Number(score)) || Number(score) < 0)
        throw new Error('A completed game is missing a verified final score.');
      return { ...row, score: Number(score) };
    });
    const game = mapEvent({ ...event, date, season: { year: season }, competitions: [{ ...competition, competitors: normalized }] }, {
      league, path: path(league), sport: league === 'NBA' ? 'Basketball' : 'Football',
    });
    if (!game || !/^\d+$/.test(game.eventId) || game.away.id === game.home.id || !game.away.name || !game.home.name)
      throw new Error('A completed matchup is incomplete.');
    games.push({ game, seasonType });
  }
  return [...new Map(games.map(entry => [entry.game.id, entry])).values()]
    .sort((a, b) => Date.parse(b.game.date) - Date.parse(a.game.date) || a.game.id.localeCompare(b.game.id));
}

async function get(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchStaticSports(url, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]));
  if (!response.ok) throw new Error(`Team game-log feed returned HTTP ${response.status}.`);
  return response.json();
}
export async function fetchTeamLogDirectory(league: TeamLogLeague, signal?: AbortSignal, refresh = false) {
  const saved = !refresh && readRenderSnapshot('teamDirectory', league, 300000);
  if (saved) return saved;
  const data = parseTeamLogDirectory(await get(`${base}/${path(league)}/teams?limit=100`, signal));
  signal?.throwIfAborted();
  saveRenderSnapshot('teamDirectory', league, data);
  return data;
}
export async function fetchTeamGameLog(league: TeamLogLeague, teamId: string, season: number, signal?: AbortSignal, refresh = false) {
  if (!/^\d+$/.test(teamId) || !Number.isInteger(season) || season < 2002 || season > new Date().getFullYear() + 1)
    throw new Error('Choose a valid team and season.');
  const key = teamLogKey(league, teamId, season);
  const saved = !refresh && readRenderSnapshot('teamGameLog', key, 300000);
  if (saved) return saved.entries;
  const entries = (await Promise.all(([1, 2, 3] as const).map(async type =>
    parseTeamGameLog(await get(`${base}/${path(league)}/teams/${teamId}/schedule?season=${season}&seasontype=${type}&limit=1000`, signal), league, teamId, season, type))))
    .flat();
  const unique = [...new Map(entries.map(entry => [entry.game.id, entry])).values()]
    .sort((a, b) => Date.parse(b.game.date) - Date.parse(a.game.date) || a.game.id.localeCompare(b.game.id));
  signal?.throwIfAborted();
  saveRenderSnapshot('teamGameLog', key, { entries: unique });
  return unique;
}
