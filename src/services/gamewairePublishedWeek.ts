import { fetchStaticSports } from './sportsDatabase';
import { getCurrentNFLWeek } from './sportsData';

export async function loadPublishedNFLWeek(week: number | null, signal: AbortSignal) {
  const base = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  const response = await fetchStaticSports(base, signal);
  if (!response.ok) throw new Error(`NFL week lookup returned HTTP ${response.status}.`);
  const current = await response.json();
  const season = Number(current?.season?.year);
  const selected = week ?? getCurrentNFLWeek(current);
  if (!Number.isInteger(season) || !selected || !Number.isInteger(selected) || selected < 1 || selected > 18)
    throw new Error('The current NFL regular-season week could not be verified.');
  let board = current;
  if (Number(current?.week?.number) !== selected || Number(current?.season?.type) !== 2) {
    const result = await fetchStaticSports(`${base}?dates=${season}&week=${selected}&seasontype=2`, signal);
    if (!result.ok) throw new Error(`NFL Week ${selected} lookup returned HTTP ${result.status}.`);
    board = await result.json();
  }
  if (Number(board?.season?.year) !== season || Number(board?.season?.type) !== 2 || Number(board?.week?.number) !== selected || !Array.isArray(board.events))
    throw new Error('NFL schedule did not match the selected regular-season week.');
  const eventIds: string[] = board.events.map((event: { id?: unknown }) => String(event.id ?? ''));
  if (eventIds.some((id) => !/^\d+$/.test(id))) throw new Error('NFL week schedule contains an invalid game identifier.');
  return { season, week: selected, eventIds };
}
