import { useEffect, useRef } from 'react';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { loadSimulationAccuracy } from './services/gamewireBot';
import { renderSimulationResultsGraphic, simulationResultsGraphicSnapshot } from './services/nflSimulationResultsGraphic';
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
      const snapshot = simulationResultsGraphicSnapshot(report, games, kind, stat);
      const blob = await renderSimulationResultsGraphic(snapshot);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      return blob;
    } finally { requests.current.delete(controller); }
  };
  return <section className="nfl-simulation-results-downloads" aria-label="Instagram simulation results graphics">
    <h4>Instagram graphics</h4>
    <p>Each download refreshes verified results for the entire selected slate and snapshots its winner record. Player graphics use the selected statistic and featured minimums.</p>
    <div>{(['games', 'players'] as const).map(kind => <ResultsGraphicDownload key={kind} generate={() => generate(kind)} disabled={false}
      filename={`GameWire-Weekly-Simulation-${kind === 'games' ? 'Games' : stat}.png`}
      label={kind === 'games' ? 'Download Instagram · Game results' : 'Download Instagram · Player props'}
      description="1080 x 1350 PNG · top three available qualifying results · selected-week winner record"
      alt={`Selected-week ${kind === 'games' ? 'game-score' : 'player-projection'} simulation results and overall winner record`}
      snapshotNote="Results and winner record were refreshed when this graphic was downloaded. Download again for newly verified finals." />)}</div>
  </section>;
}
