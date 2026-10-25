import { fetchNFLBoxScore } from './sportsData.ts';
import type { Game } from './sportsData.ts';
import { readRenderSnapshot } from './renderSnapshots.ts';

export async function preloadNFLLiveBoxes(games: Game[], signal: AbortSignal): Promise<string[]> {
  const failed: string[] = [];
  const due = games.filter((game) => game.league === 'NFL' && game.status === 'LIVE'
    && !readRenderSnapshot('box', `${game.feedPath}:${game.eventId}`, 15_000)?.teams.some((team) => team.categories.length));
  for (let start = 0; start < due.length; start += 2) {
    signal.throwIfAborted();
    await Promise.all(due.slice(start, start + 2).map(async (game) => {
      try {
        await fetchNFLBoxScore(game.feedPath, game.eventId, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        console.error(`Could not preload NFL box score ${game.eventId}`, error);
        failed.push(game.eventId);
      }
    }));
  }
  return failed;
}
