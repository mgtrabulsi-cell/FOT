import { useCallback, useEffect, useState } from 'react';
import { loadGameSimulation } from './services/gamewireBot';
import type { Game } from './services/sportsData';
import type { NFLGameSimulation } from '../supabase/functions/_shared/nflSimulation';

export function useNFLBoardSimulations(games: Game[], enabled: boolean) {
  const [simulations, setSimulations] = useState<Record<string, NFLGameSimulation>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rememberSimulation = useCallback((result: NFLGameSimulation) => {
    setSimulations(previous => ({ ...previous, [result.eventId]: result.status !== 'ready' && previous[result.eventId]?.status === 'ready'
      && Date.parse(previous[result.eventId].kickoff) === Date.parse(result.kickoff) ? { ...previous[result.eventId], refreshing: true } : result }));
    setErrors(previous => { const updated = { ...previous }; delete updated[result.eventId]; return updated; });
  }, []);
  const scope = games.filter(game => game.status === 'UPCOMING').map(game => `${game.eventId}:${game.date}:${game.home.id}:${game.away.id}`).sort().join(',');
  useEffect(() => {
    if (!enabled || !scope) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const upcoming = games.filter(game => game.status === 'UPCOMING');
    const load = async () => {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, upcoming.length) }, async () => {
        while (next < upcoming.length && !controller.signal.aborted) {
          const game = upcoming[next++];
          try {
            const result = await loadGameSimulation(game, controller.signal);
            if (controller.signal.aborted) return;
            rememberSimulation(result);
          } catch (cause) {
            if (controller.signal.aborted) return;
            console.error('NFL scoreboard simulation update failed', game.eventId, cause);
            setErrors(previous => ({ ...previous, [game.eventId]: cause instanceof Error ? cause.message : 'Simulation scores could not update.' }));
          }
        }
      }));
      if (!controller.signal.aborted) timer = window.setTimeout(() => { void load(); }, 60000);
    };
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [scope, enabled, rememberSimulation]);
  return { simulations, errors, rememberSimulation };
}
