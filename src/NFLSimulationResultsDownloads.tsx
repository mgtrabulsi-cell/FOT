import { useEffect, useRef } from 'react';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { loadGameSimulation, loadSimulationAccuracy } from './services/gamewireBot';
import { renderSimulationResultsGraphic, simulationResultsGraphicSnapshot, simulationSlateGraphicSnapshot, simulationPlayerSummarySnapshot } from './services/nflSimulationResultsGraphic';
import type { SimulationResultsGraphicKind } from './services/nflSimulationResultsGraphic';
import type { Game } from './services/sportsData';
import type { SimulationStat } from '../supabase/functions/_shared/nflSimulation';
import { fetchNFLClosingSpread } from './services/nflClosingSpread';

export default function NFLSimulationResultsDownloads({ games, stat }: { games: Game[]; stat: keyof SimulationStat }) {
  const requests = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of requests.current) controller.abort(); }, []);
  const generate = async (kind: SimulationResultsGraphicKind) => {
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
      const snapshot = kind === 'player-summary' ? simulationPlayerSummarySnapshot(report, games)
        : kind === 'slate' || kind === 'winners' ? simulationSlateGraphicSnapshot(report, games, forecasts, Date.now(), kind,
        closingSpreads.flatMap(row => row ? [row] : []))
        : simulationResultsGraphicSnapshot(report, games, kind, stat);
      const blob = await renderSimulationResultsGraphic(snapshot);
      if (controller.signal.aborted) throw new Error('The simulation graphic download was cancelled.');
      return blob;
    } finally { requests.current.delete(controller); }
  };
  return <section className="nfl-simulation-results-downloads" aria-label="Instagram simulation results graphics">
    <h4>Instagram graphics</h4>
    <p>Each download refreshes verified results for the entire selected slate and snapshots its winner record. Player props use the selected statistic; Full Player Performances use all three receiving criteria and show up to three players ordered by actual touchdowns, yards, then catches—not exact-stat accuracy.</p>
    <p>Full slate spreads uses the existing provider's closing sportsbook lines. The published simulation selects whichever team covers that line in its projected score, not necessarily the outright winner. Green means that ATS pick covered in the final score; red means it did not, and blue is a push. Live/upcoming games are not graded. Missing closing lines or forecasts, and projected pushes with no ATS pick, remain explicitly ungraded; no lines are invented.</p>
    <p>Full slate winners uses the same layout but grades only whether the simulated winner won: green wins, red losses, blue final ties. The winning margin does not affect this record.</p>
    <p>Player top 3 by category combines passing yards, receptions + receiving yards, rushing yards, and total rushing + receiving TDs in one graphic, independent of the selected statistic. Displayed simulated stats are rounded to whole numbers; rankings, error labels and minimums still use the original means. Receiving ranks average the two percentage errors; other categories rank absolute error. Every category keeps its minimums and shows only verified qualifying players.</p>
    <div>{(['games', 'players', 'performances', 'slate', 'winners', 'player-summary'] as const).map(kind => <ResultsGraphicDownload key={kind} generate={() => generate(kind)} disabled={false}
      filename={`GameWire-Weekly-Simulation-${kind === 'player-summary' ? 'Player-Top-3-Categories' : kind === 'winners' ? 'Full-Slate-Winners' : kind === 'slate' ? 'Full-Slate-Spreads' : kind === 'games' ? 'Games' : kind === 'performances' ? 'Full-Player-Performances' : stat}.png`}
      label={kind === 'player-summary' ? 'Download · Player top 3 by category' : kind === 'winners' ? 'Download · Full slate winners' : kind === 'slate' ? 'Download · Full slate spreads' : kind === 'games' ? 'Download Instagram · Game results' : kind === 'performances' ? 'Download Instagram · Full Player Performances' : 'Download Instagram · Player props'}
      description={kind === 'player-summary' ? '1080px-wide PNG · four top-three categories · simulated and actual stat lines'
        : kind === 'winners' ? '1080px-wide PNG · every game · simulated winner and win/loss record'
        : kind === 'slate' ? '1080px-wide PNG · every game · provider closing lines and simulation ATS grades'
        : '1080 x 1350 PNG · up to three qualifying results · selected-week winner record'}
      alt={kind === 'player-summary' ? 'Top three passing, receiving, rushing and total touchdown simulation results with actual stats'
        : kind === 'winners' ? 'Every selected-slate game, simulated and final scores, predicted winner and win/loss grades'
        : kind === 'slate' ? 'Every selected-slate game, published simulated and final scores, provider closing lines and ATS pick grades'
        : `Selected-week ${kind === 'games' ? 'game-score' : kind === 'performances' ? 'full receiving performance' : 'player-projection'} simulation results and overall winner record`}
      snapshotNote={kind === 'player-summary' ? 'All four categories and the slate winner record were refreshed together. Fewer than three qualifiers are shown honestly.'
        : kind === 'slate' || kind === 'winners' ? 'A refreshed snapshot of the full slate. Download again for new finals or saved simulations.'
        : 'Results and winner record were refreshed when this graphic was downloaded. Download again for newly verified finals.'} />)}</div>
  </section>;
}
