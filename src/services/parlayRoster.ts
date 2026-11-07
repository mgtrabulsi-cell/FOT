import { createDraftStorage } from './draftStorage';
import { publicSupabaseConfig } from './supabaseClient';
export type RosterSport = 'NBA' | 'NFL' | 'NHL' | 'UCL' | 'CFB' | 'Soccer';
export const isRosterSport = (value: string): value is RosterSport => ['NBA', 'NFL', 'NHL', 'UCL', 'CFB', 'Soccer'].includes(value);
export const soccerLeagues = {
  'eng.1': 'Premier League', 'esp.1': 'La Liga', 'ita.1': 'Serie A',
  'ger.1': 'Bundesliga', 'fra.1': 'Ligue 1', 'usa.1': 'MLS',
};
export type SoccerLeague = keyof typeof soccerLeagues;
export const isSoccerLeague = (value: string): value is SoccerLeague => Object.prototype.hasOwnProperty.call(soccerLeagues, value);

export type ParlayTeam = { id: string; name: string; abbr: string; logo: string; color: string };
export type ParlayPlayer = { id: string; name: string; position: string; image: string };
type Directory = { teams: ParlayTeam[]; season: number };
const cache = createDraftStorage('gamewire-parlay-rosters');
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
function directory(value: unknown): Directory {
  const data = obj(value);
  if (!Number.isInteger(data.season) || !Array.isArray(data.teams) || !data.teams.length
    || !data.teams.every((t) => t && ['id', 'name', 'abbr', 'logo', 'color'].every((k) => typeof t[k] === 'string'))) throw new Error('Invalid parlay team directory.');
  return data as Directory;
}
function roster(value: unknown): { players: ParlayPlayer[] } {
  const data = obj(value);
  if (!Array.isArray(data.players) || !data.players.length || !data.players.every((p) => p
    && ['id', 'name', 'position', 'image'].every((k) => typeof p[k] === 'string'))) throw new Error('Invalid parlay player roster.');
  return data as { players: ParlayPlayer[] };
}
async function load<T>(sport: RosterSport, team: string | undefined, season: number | undefined, read: (value: unknown) => T, signal: AbortSignal, soccerLeague: SoccerLeague = 'eng.1') {
  const key = `${sport === 'Soccer' ? `${sport}:${soccerLeague}` : sport}:${team ?? 'teams'}:${season ?? ''}`;
  let value: T;
  try {
    if (!publicSupabaseConfig) throw new Error('Account services are not configured.');
    const url = new URL(`${publicSupabaseConfig.url}/functions/v1/parlay-roster`);
    url.searchParams.set('sport', sport);
    if (sport === 'Soccer') url.searchParams.set('league', soccerLeague);
    if (team) { url.searchParams.set('team', team); url.searchParams.set('season', String(season)); }
    const response = await fetch(url, { signal });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(typeof obj(data).error === 'string' ? String(obj(data).error) : 'Roster request failed.');
    value = read(data);
  } catch (cause) {
    signal.throwIfAborted();
    const saved = await cache.load(key);
    if (saved === undefined) throw cause;
    return { data: read(saved), warning: `Using a saved roster; live player data could not refresh. ${cause instanceof Error ? cause.message : 'Reconnect and retry.'}` };
  }
  signal.throwIfAborted();
  try { await cache.save(key, value); }
  catch (cause) {
    console.error('Could not cache parlay roster', cause);
    return { data: value, warning: 'Players loaded, but could not be saved for offline search. Keep this page open or retry.' };
  }
  return { data: value, warning: '' };
}
export const loadParlayTeams = (sport: RosterSport, signal: AbortSignal, soccerLeague?: SoccerLeague) => load(sport, undefined, undefined, directory, signal, soccerLeague);
export const loadParlayPlayers = (sport: RosterSport, team: string, season: number, signal: AbortSignal) => load(sport, team, season, roster, signal);
