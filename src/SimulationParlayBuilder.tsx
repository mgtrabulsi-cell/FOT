import { useEffect, useRef, useState } from 'react';
import ParlayGraphicBuilder from './ParlayGraphicBuilder';
import { useSimulationGraphicAccess } from './useSimulationGraphicAccess';
import { defaultSettings, engineRequest, markets } from './services/gamewaire';
import type { AnalysisRun, Candidate, OddsEvent } from './services/gamewaire';
import { simulationOddsEvent, simulationParlay } from './services/simulationParlay';
import type { ParlayGraphic } from './services/parlayGraphic';
import type { NFLGameSimulation } from '../supabase/functions/_shared/nflSimulation';
import type { NBAGameSimulation } from '../supabase/functions/_shared/nbaSimulation';
import type { Game } from './services/sportsData';

export default function SimulationParlayBuilder({ game, sport, forecast }: {
  game: Game; sport: 'NFL' | 'NBA'; forecast: NFLGameSimulation | NBAGameSimulation;
}) {
  const access = useSimulationGraphicAccess();
  const [graphic, setGraphic] = useState<ParlayGraphic | null>(null);
  const [picks, setPicks] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!access.allowed) { request.current?.abort(); setBusy(false); setGraphic(null); setPicks([]); }
  }, [access.allowed]);
  if (!access.allowed) return access.error ? <p role="alert">{access.error}</p> : null;
  const create = async () => {
    const controller = new AbortController(); request.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    setBusy(true); setError(''); setGraphic(null); setPicks([]);
    try {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(game.date));
      const { events } = await engineRequest<{ events: OddsEvent[] }>({ action: 'events', sport, date }, signal);
      const event = simulationOddsEvent(events, game, sport);
      const { run } = await engineRequest<{ run: AnalysisRun }>({ action: 'analyze', sport, eventId: event.id,
        fullAnalysis: true, settings: { ...defaultSettings, markets: [...markets[sport]] } }, signal);
      signal.throwIfAborted();
      const result = simulationParlay(run, game, sport, forecast);
      setGraphic(result.graphic); setPicks(result.picks);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The simulation parlay could not be created. Retry.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="simulation-parlay" aria-label="GamewAIre three-leg simulation parlay">
    <button className="simulation-parlay-create" type="button" disabled={busy || forecast.status !== 'ready' || Date.parse(game.date) <= Date.now()}
      onClick={() => void create()}>{busy ? 'Analyzing player props...' : 'Create 3-leg sim parlay'}</button>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {graphic && <>
      <ol>{picks.map(pick => <li key={pick.key}>{pick.subject} · {(pick.probability * 100).toFixed(1)}% model hit chance</li>)}</ol>
      <ParlayGraphicBuilder value={graphic} onChange={setGraphic} standalone />
    </>}
  </section>;
}
