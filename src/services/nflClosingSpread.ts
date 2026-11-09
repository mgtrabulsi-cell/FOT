import { array, object, text } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Game } from './sportsData';

export type NFLClosingSpread = {
  eventId: string; kickoff: string; homeTeamId: string; awayTeamId: string;
  homeLine: number; awayLine: number; provider: string;
};

export function readNFLClosingSpread(value: unknown, game: Game): NFLClosingSpread | null {
  const summary = object(value), header = object(summary.header), competition = object(array(header.competitions)[0]);
  const competitors = array(competition.competitors).map(object);
  if (text(header.id) !== game.eventId || Date.parse(text(competition.date)) !== Date.parse(game.date)
    || competitors.length !== 2
    || !competitors.some(row => row.homeAway === 'home' && text(object(row.team).id) === game.home.id)
    || !competitors.some(row => row.homeAway === 'away' && text(object(row.team).id) === game.away.id))
    throw new Error('Closing spreads must match the selected game, kickoff and teams.');
  const status = object(object(competition.status).type);
  if (status.state !== 'post' || status.completed !== true) return null;
  const providers = array(summary.pickcenter).map(object);
  const providerName = (row: Record<string, unknown>) => text(object(row.provider).displayName) || text(object(row.provider).name);
  const provider = game.nflMarket?.provider
    ? providers.find(row => providerName(row) === game.nflMarket?.provider) : providers[0];
  if (!provider || !providerName(provider)) return null;
  const spreads = object(provider.pointSpread);
  const line = (value: unknown) => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const homeLine = line(object(object(spreads.home).close).line);
  const awayLine = line(object(object(spreads.away).close).line);
  if (homeLine === null || awayLine === null) return null;
  if (Math.abs(homeLine + awayLine) > 1e-9) throw new Error('The provider reported inconsistent home and away closing spreads.');
  return { eventId: game.eventId, kickoff: game.date, homeTeamId: game.home.id, awayTeamId: game.away.id,
    homeLine, awayLine, provider: providerName(provider) };
}

export async function fetchNFLClosingSpread(game: Game, signal: AbortSignal): Promise<NFLClosingSpread | null> {
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(game.eventId)}`,
    { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`The NFL closing-spread feed failed (${response.status}).`);
  return readNFLClosingSpread(await response.json(), game);
}
