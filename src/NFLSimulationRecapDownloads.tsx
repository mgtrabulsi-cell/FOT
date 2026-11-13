import { useEffect, useRef } from 'react';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { useSimulationGraphicAccess } from './useSimulationGraphicAccess';
import { loadNFLSimulationRecap } from './services/loadNFLSimulationRecap';
import { renderSimulationRecapGraphic } from './services/nflSimulationRecapGraphic';
import type { Game } from './services/sportsData';

export default function NFLSimulationRecapDownloads({ games }: { games: Game[] }) {
  const access = useSimulationGraphicAccess(), requests = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of requests.current) controller.abort(); }, [access.allowed]);
  const generate = async (game: Game) => {
    if (!access.allowed) throw new Error('Simulation recap graphics are restricted to the owner and admins.');
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const snapshot = await loadNFLSimulationRecap(game, controller.signal);
      if (controller.signal.aborted) throw new Error('The sim recap download was cancelled.');
      const blob = await renderSimulationRecapGraphic(snapshot, { away: game.away.color, home: game.home.color });
      if (controller.signal.aborted) throw new Error('The sim recap download was cancelled.');
      return blob;
    } finally { requests.current.delete(controller); }
  };
  if (!access.allowed) return access.error ? <p role="alert">{access.error}</p> : null;
  const finals = games.filter(game => game.league === 'NFL' && game.status === 'FINAL');
  if (!finals.length) return null;
  return <section className="nfl-simulation-results-downloads" aria-label="Per-game NFL sim recap graphics">
    <h4>NFL sim recap</h4>
    <p>Download a recap for each final. Pregame, game-linked Analyst Desk picks are checked against the final box score.
      Supported picks from general NFL posts are matched by team or full player identity. Ambiguous picks remain labeled for review;
      explicit admin grades are identified. No results or posts are changed.</p>
    <p>When there are no matched pregame admin picks, the recap shows selected saved-simulation highlights, not a betting record.
      Spread highlights require a recorded pregame line. Player comparisons may await final-stat verification.</p>
    {finals.map(game => <ResultsGraphicDownload key={`${game.eventId}:${game.date}`} disabled={false}
      generate={() => generate(game)} label={`Download sim recap · ${game.away.abbr} at ${game.home.abbr}`}
      filename={`GameWire-NFL-Sim-Recap-${game.away.abbr}-${game.home.abbr}-${game.date.slice(0, 10)}.png`}
      description="1080px-wide portrait PNG · final score, pick breakdown and factual analysis"
      alt={`${game.away.name} at ${game.home.name} final NFL sim recap with verified picks or selected simulation highlights`}
      snapshotNote="Refreshed final results and saved pick wording from this download. Checks are not guarantees; review states are not wins." />)}
  </section>;
}
