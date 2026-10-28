import { object, array, text } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Candidate, Sport, TeamLean } from '../../supabase/functions/_shared/gamewaire.ts';

export type SavedGame = { sport: Sport; event_id: string; event_start: string; matchup: string;
  payload?: { picks?: Candidate[]; teamLean?: TeamLean } };
export const savedGameKey = (game: Pick<SavedGame, 'sport' | 'event_id'>) => `${game.sport}:${game.event_id}`;
const teamKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^losangeles/, 'la');
const espnId = (game: SavedGame) => game.payload?.teamLean?.pick.identifiers?.espnEventId
  ?? game.payload?.picks?.find((pick) => pick.identifiers?.espnEventId)?.identifiers?.espnEventId;
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

export async function loadCompletedSavedGames(games: SavedGame[], signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const started = games.filter((game) => Date.parse(game.event_start) <= Date.now());
  const requests = new Map<string, SavedGame[]>();
  for (const game of started) {
    for (const hours of [-6, 6]) {
      const day = new Date(Date.parse(game.event_start) + hours * 60 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
      const path = game.sport === 'NBA' ? 'basketball/nba' : 'football/nfl';
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}&limit=100`;
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
      const path = game.sport === 'NBA' ? 'basketball/nba' : 'football/nfl';
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
  const incomplete = failed || started.some((game) => !confirmed.has(savedGameKey(game)));
  return { completed: [...completed], completionWarning: incomplete ? 'Some game statuses could not update. Unconfirmed games remain in saved review; reconnect or retry.' : '' };
}
