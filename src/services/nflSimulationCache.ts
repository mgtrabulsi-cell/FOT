import { createDraftStorage } from './draftStorage.ts';
import { readNFLGameSimulation } from '../../supabase/functions/_shared/nflSimulation.ts';
import type { NFLGameSimulation } from '../../supabase/functions/_shared/nflSimulation.ts';
import type { Game } from './sportsData.ts';

const storage = createDraftStorage('gamewire-nfl-simulations');
const memory = new Map<string, NFLGameSimulation>();
const key = (game: Game) => `${game.eventId}:${Date.parse(game.date)}:${game.home.id}:${game.away.id}`;
const parse = (game: Game, value: unknown) =>
  readNFLGameSimulation(value, game.eventId, game.date, { home: game.home.id, away: game.away.id });

export async function readSavedGameSimulation(game: Game): Promise<NFLGameSimulation | null> {
  const name = key(game);
  const cached = memory.get(name);
  if (cached) return cached;
  try {
    const stored = await storage.load(name);
    const updated = memory.get(name);
    if (updated) return updated;
    if (stored === undefined) return null;
    const result = parse(game, stored);
    if (result.status !== 'ready') throw new Error('The saved simulation is incomplete.');
    memory.set(name, result);
    return result;
  } catch (cause) {
    console.error('Could not restore the device simulation', game.eventId, cause);
    return null;
  }
}

export async function saveGameSimulation(game: Game, forecast: NFLGameSimulation): Promise<boolean> {
  const result = parse(game, forecast);
  if (result.status !== 'ready') return false;
  const name = key(game), previous = memory.get(name);
  const latest = previous && Date.parse(previous.forecastAt ?? '') > Date.parse(result.forecastAt ?? '') ? previous : result;
  memory.set(name, latest);
  try {
    await storage.save(name, latest);
    return true;
  } catch (cause) {
    console.error('Could not save the simulation for offline use', game.eventId, cause);
    return false;
  }
}
