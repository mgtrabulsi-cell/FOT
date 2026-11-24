import { useEffect, useRef } from 'react';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { loadGameSimulation, loadSimulationAccuracy } from './services/gamewireBot';
import { renderSimulationResultsGraphic, renderSimulationTouchdownGraphics, simulationResultsGraphicSnapshot, simulationSlateGraphicSnapshot, simulationPlayerSummarySnapshot, simulationTouchdownSnapshot } from './services/nflSimulationResultsGraphic';
import type { SimulationResultsGraphicKind } from './services/nflSimulationResultsGraphic';
import type { Game } from './services/sportsData';
import type { SimulationStat } from '../supabase/functions/_shared/nflSimulation';
import { fetchNFLClosingSpread } from './services/nflClosingSpread';
import { useSimulationGraphicAccess } from './useSimulationGraphicAccess';
import { loadSavedNFLTouchdownOdds } from './services/nflTouchdownOdds';

export default function NFLSimulationResultsDownloads({ games, stat }: { games: Game[]; stat: keyof SimulationStat }) {
  const access = useSimulationGraphicAccess();
  const requests = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of requests.current) controller.abort(); }, [access.allowed]);
  const generate = async (kind: SimulationResultsGraphicKind) => {
    if (!access.allowed) throw new Error('Simulation graphics are restricted to the owner and admins.');
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const report = await loadSimulationAccuracy(games, controller.signal);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      const fullSlate = kind === 'slate' || kind === 'winners';
      const [forecasts, closingSpreads] = await Promise.all([fullSlate ? Promise.all(games.filter(game => !report.games.some(row => row.eventId === game.eventId)).map(async game => {
        try { return { eventId: game.eventId, forecast: await loadGameSimulation(game, controller.signal) }; }
        catch (cause) {
          if (controller.signal.aborted) throw cause;
          console.error('NFL slate graphic simulation unavailable', game.eventId, cause);
          return { eventId: game.eventId, error: 'Archive/feed unavailable' };
        }
      })) : Promise.resolve([]), kind === 'slate' ? Promise.all(games.map(async game => {
        try { return await fetchNFLClosingSpread(game, controller.signal); }
        catch (cause) {
          if (controller.signal.aborted) throw cause;
          console.error('NFL slate graphic closing line unavailable', game.eventId, cause);
          return null;
        }
      })) : Promise.resolve([])]);
      const touchdownOdds = kind === 'touchdowns' ? await loadSavedNFLTouchdownOdds(games, controller.signal) : [];
      const snapshot = kind === 'touchdowns' ? simulationTouchdownSnapshot(report, games, Date.now(), touchdownOdds)
        : kind === 'player-summary' ? simulationPlayerSummarySnapshot(report, games)
        : kind === 'slate' || kind === 'winners' ? simulationSlateGraphicSnapshot(report, games, forecasts, Date.now(), kind,
        closingSpreads.flatMap(row => row ? [row] : []))
        : simulationResultsGraphicSnapshot(report, games, kind, stat);
      const blob = kind === 'touchdowns' ? await renderSimulationTouchdownGraphics(snapshot) : await renderSimulationResultsGraphic(snapshot);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      return blob;
    } finally { requests.current.delete(controller); }
  };
  if (!access.allowed) return access.error ? <p role="alert">{access.error}</p> : null;
  return <section className="nfl-simulation-results-downloads" aria-label="Instagram simulation results graphics">
    <h4>Instagram graphics</h4>
    <div>{(['games', 'players', 'performances', 'slate', 'winners', 'player-summary', 'touchdowns'] as const).map(kind => <ResultsGraphicDownload key={kind} generate={() => generate(kind)} disabled={false}
      filename={`GameWire-Weekly-Simulation-${kind === 'touchdowns' ? 'Touchdown-Scorers' : kind === 'player-summary' ? 'Player-Top-3-Categories' : kind === 'winners' ? 'Full-Slate-Winners' : kind === 'slate' ? 'Full-Slate-Spreads' : kind === 'games' ? 'Games' : kind === 'performances' ? 'Full-Player-Performances' : stat}.png`}
      label={kind === 'touchdowns' ? 'Download · All touchdown calls that scored' : kind === 'player-summary' ? 'Download · Player top 3 by category' : kind === 'winners' ? 'Download · Full slate winners' : kind === 'slate' ? 'Download · Full slate spreads' : kind === 'games' ? 'Download Instagram · Game results' : kind === 'performances' ? 'Download Instagram · Full Player Performances' : 'Download Instagram · Player props'}
      description={kind === 'touchdowns' ? '1080 x 1350 Instagram slides · 10 scorers per slide · every qualifier included · individual save links below'
        : kind === 'player-summary' ? '1080px-wide PNG · four top-three categories · simulated and actual stat lines'
        : kind === 'winners' ? '1080px-wide PNG · every game · simulated winner and win/loss record'
        : kind === 'slate' ? '1080px-wide PNG · every game · provider closing lines and simulation ATS grades'
        : '1080 x 1350 PNG · up to three qualifying results · selected-week winner record'}
      alt={kind === 'touchdowns' ? 'Every projected touchdown scorer who scored, with simulated and actual touchdown totals, saved pregame anytime touchdown odds and sportsbook; unavailable when no saved price exists'
        : kind === 'player-summary' ? 'Top three passing, receiving, rushing and total touchdown simulation results with actual stats'
        : kind === 'winners' ? 'Every selected-slate game, simulated and final scores, predicted winner and win/loss grades'
        : kind === 'slate' ? 'Every selected-slate game, published simulated and final scores, provider closing lines and ATS pick grades'
        : `Selected-week ${kind === 'games' ? 'game-score' : kind === 'performances' ? 'full receiving performance' : 'player-projection'} simulation results and overall winner record`}
      snapshotNote={kind === 'player-summary' ? 'All four categories and the slate winner record were refreshed together. Fewer than three qualifiers are shown honestly.'
        : kind === 'slate' || kind === 'winners' ? 'A refreshed snapshot of the full slate. Download again for new finals or saved simulations.'
        : 'Results and winner record were refreshed when this graphic was downloaded. Download again for newly verified finals.'} />)}</div>
  </section>;
}
