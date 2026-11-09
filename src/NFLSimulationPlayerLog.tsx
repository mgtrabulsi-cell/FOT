import { useEffect, useState } from 'react';
import type { Game, NFLPlayerGame, NFLPlayerStatKey } from './services/sportsData';
import { fetchPlayerGameLog } from './services/matchupBoard';
import type { SimulationPlayerResult } from '../supabase/functions/_shared/nflSimulation';

const columns: Record<SimulationPlayerResult['position'], Array<[NFLPlayerStatKey, string]>> = {
  QB: [['completions', 'CMP'], ['attempts', 'ATT'], ['passingYards', 'PASS YDS'], ['passingTouchdowns', 'PASS TD'], ['interceptions', 'INT'], ['rushingYards', 'RUSH YDS'], ['rushingTouchdowns', 'RUSH TD']],
  RB: [['carries', 'ATT'], ['rushingYards', 'RUSH YDS'], ['rushingTouchdowns', 'RUSH TD'], ['receptions', 'REC'], ['receivingYards', 'REC YDS'], ['receivingTouchdowns', 'REC TD']],
  WR: [['receptions', 'REC'], ['targets', 'TGT'], ['receivingYards', 'REC YDS'], ['receivingTouchdowns', 'REC TD']],
  TE: [['receptions', 'REC'], ['targets', 'TGT'], ['receivingYards', 'REC YDS'], ['receivingTouchdowns', 'REC TD']],
};

export default function NFLSimulationPlayerLog({ player, game, onClose }: {
  player: SimulationPlayerResult; game: Game; onClose: () => void;
}) {
  const [rows, setRows] = useState<NFLPlayerGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setRows([]);
    void fetchPlayerGameLog(player.id, game, controller.signal).then(result => {
      if (!controller.signal.aborted) setRows(result);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      console.error('Simulation player game log failed', player.id, cause);
      setError(cause instanceof Error ? cause.message : 'Player game log could not load.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [player.id, game.eventId, game.date, game.seasonYear, retry]);
  return <section className="nfl-simulation-player-log" aria-label={`${player.name} past game stats`}>
    <header><h4>{player.name} · Game log</h4><button type="button" onClick={onClose}>Close game log</button></header>
    <p>Actual regular-season stats before this matchup, newest first. Full-game totals include overtime; these are not simulations. Missing stats are shown as —.</p>
    <p className="nfl-simulation-log-scroll-hint">Swipe the table sideways for more stats.</p>
    {loading && <p role="status">Loading past games…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry game log</button></div>}
    {!loading && !error && !rows.length && <p>No reported regular-season games are available before this matchup.</p>}
    {!!rows.length && <div className="nfl-simulation-table-scroll" tabIndex={0} role="region" aria-label={`${player.name} game log table`}>
      <table><caption>{player.position} · Past game stats</caption>
        <thead><tr><th scope="col">Game / result</th>{columns[player.position].map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.gameId}><th scope="row"><b>{row.opponentAbbreviation || row.opponent || '—'}</b><small>{new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</small>
          <small>{[row.result, row.score].filter(Boolean).join(' ') || '—'}</small></th>
          {columns[player.position].map(([key]) => <td key={key}>{row.stats[key] ?? <span aria-label="Statistic unavailable">—</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
