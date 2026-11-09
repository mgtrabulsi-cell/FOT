import { useEffect, useRef } from 'react';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { loadGameSimulation, loadSimulationAccuracy } from './services/gamewireBot';
import { renderSimulationResultsGraphic, simulationResultsGraphicSnapshot, simulationSlateGraphicSnapshot } from './services/nflSimulationResultsGraphic';
import type { SimulationResultsGraphicKind } from './services/nflSimulationResultsGraphic';
import type { Game } from './services/sportsData';
import type { SimulationStat } from '../supabase/functions/_shared/nflSimulation';

export default function NFLSimulationResultsDownloads({ games, stat }: { games: Game[]; stat: keyof SimulationStat }) {
  const requests = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of requests.current) controller.abort(); }, []);
  const generate = async (kind: SimulationResultsGraphicKind) => {
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const report = await loadSimulationAccuracy(games, controller.signal);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      const forecasts = kind === 'slate' ? await Promise.all(games.filter(game => !report.games.some(row => row.eventId === game.eventId)).map(async game => {
        try { return { eventId: game.eventId, forecast: await loadGameSimulation(game, controller.signal) }; }
        catch (cause) {
          if (controller.signal.aborted) throw cause;
          console.error('NFL slate graphic simulation unavailable', game.eventId, cause);
          return { eventId: game.eventId, error: 'Archive/feed unavailable' };
        }
      })) : [];
      const snapshot = kind === 'slate' ? simulationSlateGraphicSnapshot(report, games, forecasts)
        : simulationResultsGraphicSnapshot(report, games, kind, stat);
      const blob = await renderSimulationResultsGraphic(snapshot);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      return blob;
    } finally { requests.current.delete(controller); }
  };
  return <section className="nfl-simulation-results-downloads" aria-label="Instagram simulation results graphics">
    <h4>Instagram graphics</h4>
    <p>Each download refreshes verified results for the entire selected slate and snapshots its winner record. Player props use the selected statistic; Full Player Performances use all three receiving criteria and show up to three players ordered by actual touchdowns, yards, then catches—not exact-stat accuracy.</p>
    <p>Full slate spreads includes every game in kickoff order. Green means the predicted winner exceeded its simulated winning margin; red means it did not, and blue means an exact-margin push. Live/upcoming games are not graded; missing archives or feed failures are labeled unavailable. These are simulation-derived spreads, not sportsbook lines.</p>
    <div>{(['games', 'players', 'performances', 'slate'] as const).map(kind => <ResultsGraphicDownload key={kind} generate={() => generate(kind)} disabled={false}
      filename={`GameWire-Weekly-Simulation-${kind === 'slate' ? 'Full-Slate-Spreads' : kind === 'games' ? 'Games' : kind === 'performances' ? 'Full-Player-Performances' : stat}.png`}
      label={kind === 'slate' ? 'Download · Full slate spreads' : kind === 'games' ? 'Download Instagram · Game results' : kind === 'performances' ? 'Download Instagram · Full Player Performances' : 'Download Instagram · Player props'}
      description={kind === 'slate' ? '1080px-wide PNG · height adapts to every game · published scores and simulated-spread grades'
        : '1080 x 1350 PNG · up to three qualifying results · selected-week winner record'}
      alt={kind === 'slate' ? 'Every selected-slate game, published simulated scores, final scores and simulated-spread cover grades'
        : `Selected-week ${kind === 'games' ? 'game-score' : kind === 'performances' ? 'full receiving performance' : 'player-projection'} simulation results and overall winner record`}
      snapshotNote={kind === 'slate' ? 'A refreshed snapshot of the full slate. Download again for new finals or saved simulations.'
        : 'Results and winner record were refreshed when this graphic was downloaded. Download again for newly verified finals.'} />)}</div>
  </section>;
}
