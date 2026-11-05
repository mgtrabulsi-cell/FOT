import { useEffect, useMemo, useState } from 'react';
import { engineRequest } from './services/gamewaire';
import type { Sport } from './services/gamewaire';
import type { Game } from './services/sportsData';
import { matchWirePicks } from './services/wireTeamPicks';
import type { WireTeamPick } from './services/wireTeamPicks';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import { subscribePickOrderRefresh } from './services/gamewaireOrderRefresh';

export function useWireTeamPicks(games: Game[], sport: Sport, userId?: string, enabled = true) {
  const [candidates, setCandidates] = useState<{ scope: string; picks: WireTeamPick[] }>({ scope: '', picks: [] });
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const ids = games.map(game => game.eventId).sort().join(',');
  const dates = games.map(game => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(game.date))).sort();
  const firstDate = dates[0], lastDate = dates[dates.length - 1];
  const scope = `${sport}:${userId ?? 'guest'}:${ids}:${firstDate}:${lastDate}`;
  useEffect(() => subscribeForegroundRefresh(() => setRevision(value => value + 1)), []);
  useEffect(() => subscribePickOrderRefresh(() => setRevision(value => value + 1)), []);
  useEffect(() => {
    setError('');
    if (!enabled || !userId || !ids) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const load = async () => {
      const result = await engineRequest<{ picks: WireTeamPick[]; analyzedGames: number }>({
        action: 'scoreboardPicks', sport, firstDate, lastDate,
      }, controller.signal);
      if (!Array.isArray(result.picks) || !Number.isInteger(result.analyzedGames))
        throw new Error('Invalid matchup-score response');
      if (!controller.signal.aborted) {
        setCandidates({ scope, picks: result.picks });
        if (result.analyzedGames < games.length)
          setError(`GamewAIre has current-model analysis for ${result.analyzedGames} of ${games.length} matchups. Missing or nonqualifying games receive no pick; three selections are never forced.`);
      }
    };
    let active = true;
    void load().catch((cause: unknown) => {
      if (active) setError(`GamewAIre picks could not refresh: ${controller.signal.aborted ? 'request timed out' : cause instanceof Error ? cause.message : 'source unavailable'}. Any visible picks are saved pregame selections, not live prices.`);
    }).finally(() => window.clearTimeout(timeout));
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) setRevision(value => value + 1);
    }, 60_000);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.clearInterval(timer); };
  }, [scope, ids, sport, userId, enabled, revision, firstDate, lastDate, games.length]);
  const badges = useMemo(() => matchWirePicks(games, enabled && userId && candidates.scope === scope ? candidates.picks : []), [games, candidates, scope, enabled, userId]);
  return { badges, error };
}
