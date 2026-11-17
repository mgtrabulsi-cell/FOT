import { useCallback, useEffect, useState } from 'react';
import { loadGameSimulation, readSavedGameSimulation } from './services/gamewireBot';
import type { Game } from './services/sportsData';
import type { NFLGameSimulation } from '../supabase/functions/_shared/nflSimulation';

export function useNFLBoardSimulations(games: Game[], enabled: boolean) {
  return useBoardSimulations<NFLGameSimulation>(games, enabled, loadGameSimulation, readSavedGameSimulation);
}
export function useBoardSimulations<T extends { eventId: string; kickoff: string; status: string; forecastAt: string | null; refreshing?: boolean }>(
  games: Game[], enabled: boolean, loadSimulation: (game: Game, signal: AbortSignal) => Promise<T>,
  readSimulation: (game: Game) => Promise<T | null>,
) {
  const [simulations, setSimulations] = useState<Record<string, T>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rememberSimulation = useCallback((result: T, clearError = true) => {
    setSimulations(previous => {
      const saved = previous[result.eventId], sameGame = saved && Date.parse(saved.kickoff) === Date.parse(result.kickoff);
      if (sameGame && saved.status === 'ready' && result.status === 'ready'
        && Date.parse(saved.forecastAt ?? '') > Date.parse(result.forecastAt ?? '')) return previous;
      return { ...previous, [result.eventId]: result.status !== 'ready' && sameGame && saved.status === 'ready'
        ? { ...saved, refreshing: true } : result };
    });
    if (clearError) setErrors(previous => { const updated = { ...previous }; delete updated[result.eventId]; return updated; });
  }, []);
  const scope = games.map(game => `${game.eventId}:${game.date}:${game.home.id}:${game.away.id}`).sort().join(',');
  useEffect(() => {
    if (!enabled || !scope) return;
    const controller = new AbortController();
    let timer: number | undefined, inFlight = false;
    for (const game of games) {
      void readSimulation(game).then(saved => {
        if (saved && !controller.signal.aborted) rememberSimulation(saved, false);
      });
    }
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, games.length) }, async () => {
        while (next < games.length && !controller.signal.aborted) {
          const game = games[next++];
          try {
            const result = await loadSimulation(game, controller.signal);
            if (controller.signal.aborted) return;
            rememberSimulation(result);
          } catch (cause) {
            if (controller.signal.aborted) return;
            console.error('Scoreboard simulation update failed', game.eventId, cause);
            setErrors(previous => ({ ...previous, [game.eventId]: cause instanceof Error ? cause.message : 'Simulation scores could not update.' }));
          }
        }
      }));
      inFlight = false;
      if (!controller.signal.aborted) timer = window.setTimeout(() => { void load(); }, 60000);
    };
    const reconnect = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!inFlight) void load();
    };
    void load();
    window.addEventListener('online', reconnect);
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener('online', reconnect); };
  }, [scope, enabled, rememberSimulation, loadSimulation, readSimulation]);
  return { simulations, errors, rememberSimulation };
}
