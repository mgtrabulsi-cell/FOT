import { object, array, text, isSoccer } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Candidate, Sport, TeamLean } from '../../supabase/functions/_shared/gamewaire.ts';

export type SavedGame = { sport: Sport; event_id: string; event_start: string; matchup: string;
  payload?: { picks?: Candidate[]; teamLean?: TeamLean } };
export const savedGameKey = (game: Pick<SavedGame, 'sport' | 'event_id'>) => `${game.sport}:${game.event_id}`;
const teamKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^losangeles/, 'la');
const soccerPaths = { EPL: 'soccer/eng.1', 'Serie A': 'soccer/ita.1', 'La Liga': 'soccer/esp.1', Bundesliga: 'soccer/ger.1' };
const sportPath = (sport: Sport) => isSoccer(sport) ? soccerPaths[sport] : sport === 'NBA' ? 'basketball/nba' : 'football/nfl';
const espnId = (game: SavedGame) => game.payload?.teamLean?.pick.identifiers?.espnEventId
  ?? game.payload?.picks?.find((pick) => pick.identifiers?.espnEventId)?.identifiers?.espnEventId;
export function easternGameDate(value: string | number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function isSavedGamePastReview(game: Pick<SavedGame, 'sport' | 'event_start'>, now = Date.now()) {
  const start = Date.parse(game.event_start);
  if (!Number.isFinite(start) || start > now) return false;
  return now >= start + (game.sport === 'NFL' ? 5 : 4) * 60 * 60_000;
}
function savedGameStatus(game: SavedGame, events: unknown[]): boolean | undefined {
  const [away, home] = game.matchup.split(' @ ');
  if (!away || !home) return undefined;
  for (const raw of events) {
    const event = object(raw), competition = object(array(event.competitions)[0]);
    const id = espnId(game);
    if (id) {
      if (text(event.id) !== id) continue;
    } else {
      const timeDifference = Math.abs(Date.parse(text(event.date)) - Date.parse(game.event_start));
      if (!Number.isFinite(timeDifference) || timeDifference > 6 * 60 * 60_000) continue;
    }
    const sides = array(competition.competitors).map(object);
    if (!sides.some((side) => side.homeAway === 'home' && teamKey(text(object(side.team).displayName)) === teamKey(home))
      || !sides.some((side) => side.homeAway === 'away' && teamKey(text(object(side.team).displayName)) === teamKey(away))) continue;
    const completed = object(object(competition.status).type).completed;
    if (typeof completed === 'boolean') return completed;
  }
  return undefined;
}
export function completedSavedGames(games: SavedGame[], events: unknown[]): string[] {
  return games.filter((game) => savedGameStatus(game, events) === true).map(savedGameKey);
}

export async function loadCompletedSavedGames(games: SavedGame[], signal: AbortSignal, fetcher: typeof fetch = fetch, now = Date.now()) {
  const started = games.filter((game) => Date.parse(game.event_start) <= now);
  const requests = new Map<string, SavedGame[]>();
  for (const game of started) {
    const start = Date.parse(game.event_start);
    const days = new Set([easternGameDate(start), easternGameDate(start + 12 * 60 * 60_000), easternGameDate(start - 12 * 60 * 60_000)]);
    for (const day of days) {
      const path = sportPath(game.sport);
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day.replace(/-/g, '')}&limit=100`;
      requests.set(url, [...(requests.get(url) ?? []), game]);
    }
  }
  const completed = new Set<string>();
  const confirmed = new Set<string>();
  let failed = false;
  await Promise.all([...requests].map(async ([url, group]) => {
    try {
      const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store' });
      if (!response.ok) throw new Error(`Game status feed returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      if (!Array.isArray(object(data).events)) throw new Error('Game status feed returned invalid events.');
      for (const game of group) {
        const status = savedGameStatus(game, array(object(data).events));
        if (status !== undefined) confirmed.add(savedGameKey(game));
        if (status === true) completed.add(savedGameKey(game));
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      console.error('Could not check finished GamewAIre games', cause);
      failed = true;
    }
  }));
  const unresolved = new Map<string, { game: SavedGame; id: string }>();
  for (const game of started) {
    const id = espnId(game);
    if (id && !confirmed.has(savedGameKey(game))) unresolved.set(savedGameKey(game), { game, id });
  }
  await Promise.all([...unresolved.values()].map(async ({ game, id }) => {
    try {
      const path = sportPath(game.sport);
      const response = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${encodeURIComponent(id)}`,
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), cache: 'no-store' });
      if (!response.ok) throw new Error(`Game status feed returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      const status = savedGameStatus(game, [object(data).header]);
      if (status !== undefined) confirmed.add(savedGameKey(game));
      if (status === true) completed.add(savedGameKey(game));
    } catch (cause) {
      if (signal.aborted) throw cause;
      console.error('Could not check the saved ESPN event status', cause);
      failed = true;
    }
  }));
  for (const game of started) {
    const key = savedGameKey(game);
    if (completed.has(key) || confirmed.has(key)) continue;
    if (isSavedGamePastReview(game, now)) completed.add(key);
  }
  const incomplete = failed || started.some((game) => !confirmed.has(savedGameKey(game)) && !completed.has(savedGameKey(game)));
  return { completed: [...completed], completionWarning: incomplete ? 'Some game statuses could not update. Unconfirmed games remain in saved review; reconnect or retry.' : '' };
}
