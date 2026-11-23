import type { Game } from './sportsData';

export type GameInjury = { id: string; name: string; teamId: string; status: string; date: string };
export type GameInjuryReport = { eventId: string; checkedAt: string; players: GameInjury[] };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function parseGameInjuries(value: unknown, game: Game, checkedAt = new Date().toISOString()): GameInjuryReport {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]);
  const competitors = array(competition.competitors).map(object);
  if (text(header.id) !== game.eventId || !(['home', 'away'] as const).every(side =>
    text(object(competitors.find(row => row.homeAway === side)?.team).id) === game[side].id))
    throw new Error('The injury report does not match this matchup.');
  if (!Array.isArray(data.injuries)) throw new Error('The provider has not supplied a verified injury report for this matchup.');
  const players = new Map<string, GameInjury>();
  for (const raw of data.injuries) {
    const group = object(raw), teamId = text(object(group.team).id);
    if (![game.home.id, game.away.id].includes(teamId)) throw new Error('The injury report contains an unexpected team.');
    if (!Array.isArray(group.injuries)) throw new Error('The provider injury list is incomplete.');
    for (const entry of group.injuries) {
      const row = object(entry), athlete = object(row.athlete), id = text(athlete.id), name = text(athlete.displayName) || text(athlete.fullName);
      const rawStatus = text(row.status) || text(object(row.details).status);
      if (!id || !name || !rawStatus) throw new Error('A player injury designation is incomplete. Retry for an updated report.');
      const status = rawStatus.toLowerCase() === 'out' ? 'OUT' : rawStatus;
      const injury: GameInjury = { id, name, teamId, status, date: text(row.date) };
      const key = `${teamId}:${id}`, previous = players.get(key);
      if (!previous || (Date.parse(injury.date) || 0) > (Date.parse(previous.date) || 0)) players.set(key, injury);
      else if ((Date.parse(injury.date) || 0) === (Date.parse(previous.date) || 0) && injury.status !== previous.status)
        players.set(key, { ...previous, status: 'Unconfirmed (conflicting report)' });
    }
  }
  return { eventId: game.eventId, checkedAt, players: [...players.values()] };
}
const saved = new Map<string, GameInjuryReport>();
export async function fetchGameInjuries(game: Game, signal: AbortSignal): Promise<GameInjuryReport> {
  if (game.league !== 'NFL' && game.league !== 'NBA') throw new Error('Injury reports are supported for NFL and NBA matchups.');
  const key = `${game.league}:${game.eventId}:${game.date}:${game.home.id}:${game.away.id}`, cached = saved.get(key);
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 30_000) return cached;
  const path = game.league === 'NBA' ? 'basketball/nba' : 'football/nfl';
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(game.eventId)}`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), cache: 'no-store' });
  if (!response.ok) throw new Error(`Injury report returned HTTP ${response.status}.`);
  const report = parseGameInjuries(await response.json(), game);
  signal.throwIfAborted();
  saved.set(key, report);
  return report;
}
