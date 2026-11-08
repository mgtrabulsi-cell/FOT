import { useEffect, useId, useState } from 'react';
import type { Game } from './services/sportsData';
import { loadSimulationAccuracy } from './services/gamewireBot';
import { featuredSimulationMinimums, isFeaturedSimulationPlayer, simulationAccuracyStats } from '../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationAccuracyReport } from '../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationStat } from '../supabase/functions/_shared/nflSimulation';

const number = (value: number) => value.toFixed(1);
export function NFLSimulationResults({ games }: { games: Game[] }) {
  const [selectedEvent, setSelectedEvent] = useState('all');
  const selectedGame = games.find(game => game.eventId === selectedEvent);
  const selectedGames = selectedEvent === 'all' ? games : selectedGame ? [selectedGame] : [];
  return <section className="wire-simulation-results" aria-label="Simulation Results">
    <h2>Simulation Results</h2>
    <p>Choose a game to compare its saved pregame scores and player projections with verified actual results, or view this slate’s closest predictions.</p>
    <label>Game <select value={selectedEvent} onChange={event => setSelectedEvent(event.target.value)}>
      <option value="all">All games · weekly accuracy rankings</option>
      {games.map(game => <option key={game.eventId} value={game.eventId}>{game.away.abbr} at {game.home.abbr} · {game.status}</option>)}
    </select></label>
    {!selectedGames.some(game => game.status === 'FINAL') && <p role="status">{selectedGames.length
      ? 'Results will be available after a game finishes and final statistics are verified.'
      : 'No games are available in this selection.'}</p>}
    <NFLSimulationAccuracy key={selectedEvent} games={selectedGames} weekly={selectedEvent === 'all'} />
  </section>;
}

export default function NFLSimulationAccuracy({ games, weekly = false }: { games: Game[]; weekly?: boolean }) {
  const [report, setReport] = useState<SimulationAccuracyReport | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [stat, setStat] = useState<keyof SimulationStat>('passingYards');
  const [gamesExpanded, setGamesExpanded] = useState(false);
  const [playersExpanded, setPlayersExpanded] = useState(false);
  const id = useId();
  const scope = games.map(game => `${game.eventId}:${game.date}:${game.home.id}:${game.away.id}`).sort().join(',');
  const hasFinished = games.some(game => game.status === 'FINAL');
  useEffect(() => {
    if (!hasFinished) return;
    const controller = new AbortController();
    let timer: number | undefined;
    setReport(null); setError('');
    const load = async () => {
      try {
        const data = await loadSimulationAccuracy(games, controller.signal);
        if (controller.signal.aborted) return;
        setReport(data); setError('');
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error('Could not load NFL simulation accuracy', cause);
        setError(cause instanceof Error ? cause.message : 'Simulation accuracy results could not load. Retry.');
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => { void load(); }, 60000);
    };
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [scope, hasFinished, retry]);
  if (!hasFinished) return null;
  const playerRows = report?.games.flatMap(game => game.players.filter(player => player.stat === stat).map(player => ({ ...player, game })))
    .sort((a, b) => a.error - b.error || a.game.eventId.localeCompare(b.game.eventId) || a.playerId.localeCompare(b.playerId)) ?? [];
  const playerHighlights = playerRows.filter(isFeaturedSimulationPlayer).slice(0, 3);
  const featuredMinimum = featuredSimulationMinimums[stat];
  return <section className="nfl-simulation-accuracy" aria-label={weekly ? 'Selected week simulation accuracy' : 'Game simulation accuracy'}>
    <header><h3>{weekly ? 'This slate’s simulation accuracy' : 'Simulation vs. final results'}</h3>
      <button type="button" onClick={() => setRetry(value => value + 1)}>Refresh results</button></header>
    <p>Published pregame scores vs. verified final results. Closest first; smaller differences are better. Select a top-three card to see all comparisons. Final-stat verification normally takes up to 15 minutes.</p>
    {error && <p role="alert">{error} Saved results remain visible when available.</p>}
    {!report && !error && <p role="status">Loading verified results…</p>}
    {report && <>
      {report.pending > 0 && <p>{report.pending} game{report.pending === 1 ? '' : 's'} awaiting a final result or verification.</p>}
      <div className="nfl-accuracy-cards">
      <section className="nfl-accuracy-card" aria-label="Game results">
      <button type="button" className="nfl-accuracy-card-toggle" aria-expanded={gamesExpanded} aria-controls={`${id}-games`} onClick={() => setGamesExpanded(value => !value)}>
        <span className="nfl-accuracy-card-title">Game results <small>Top {Math.min(3, report.games.length)}</small></span>
        <span className="nfl-accuracy-card-list" role="list">{report.games.slice(0, 3).map((game, index) => <span className="nfl-accuracy-card-row" role="listitem" key={game.eventId}>
          <b>{index + 1}. {game.away.abbr} – {game.home.abbr}</b>
          <span>Sim {Math.round(game.away.projected)} – {Math.round(game.home.projected)} · Actual {game.away.actual} – {game.home.actual}</span>
          <small>{number(game.error)} average points missed</small>
        </span>)}</span>
        {!report.games.length && <span>No eligible verified game comparisons yet.</span>}
        <span className="nfl-accuracy-card-action">{gamesExpanded ? 'Hide full results' : 'View all game results'}</span>
      </button>
      <div id={`${id}-games`} hidden={!gamesExpanded}>
      <h4>Game scores · average points missed across both teams</h4>
      {report.games.length ? <div className="nfl-accuracy-table-wrap"><table><thead><tr>
        <th scope="col">Rank / game</th><th scope="col">Simulated</th><th scope="col">Actual</th><th scope="col">Avg. difference</th>
      </tr></thead><tbody>{report.games.map((game, index) => <tr key={game.eventId}>
        <th scope="row">{weekly ? `${index + 1}. ` : ''}{game.away.abbr} – {game.home.abbr}<small>{game.scenario}</small></th>
        <td>{Math.round(game.away.projected)} – {Math.round(game.home.projected)}</td>
        <td>{game.away.actual} – {game.home.actual}</td><td>{number(game.error)} pts</td>
      </tr>)}</tbody></table></div> : <p>No eligible verified game comparisons yet.</p>}
      </div>
      </section>
      <section className="nfl-accuracy-card" aria-label="Player props">
      <label>Statistic <select value={stat} onChange={event => {
        const value = event.target.value;
        if (Object.prototype.hasOwnProperty.call(simulationAccuracyStats, value)) setStat(value as keyof SimulationStat);
      }}>{Object.entries(simulationAccuracyStats).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="nfl-accuracy-card-toggle" aria-expanded={playersExpanded} aria-controls={`${id}-players`} onClick={() => setPlayersExpanded(value => !value)}>
        <span className="nfl-accuracy-card-title">Player props <small>Top {playerHighlights.length} · {simulationAccuracyStats[stat]}</small></span>
        {featuredMinimum !== undefined && <span className="nfl-accuracy-highlight-minimum">Featured minimum: {featuredMinimum} in both simulated and actual results.</span>}
        <span className="nfl-accuracy-card-list" role="list">{playerHighlights.map((player, index) => <span className="nfl-accuracy-card-row" role="listitem" key={`${player.game.eventId}:${player.playerId}`}>
          <b>{index + 1}. {player.name} · {player.team}</b>
          <span>Sim {number(player.projected)} · Actual {player.actual}</span><small>{number(player.error)} difference</small>
        </span>)}</span>
        {!playerHighlights.length && <span>No eligible highlights meet the featured minimums yet. Expand to view all available comparisons.</span>}
        <span className="nfl-accuracy-card-action">{playersExpanded ? 'Hide full results' : 'View all player results'}</span>
      </button>
      <div id={`${id}-players`} hidden={!playersExpanded}>
      <h4>Player projections · closest within each statistic</h4>
      {playerRows.length ? <div className="nfl-accuracy-table-wrap"><table><thead><tr>
        <th scope="col">Rank / player</th><th scope="col">Simulated</th><th scope="col">Actual</th><th scope="col">Difference</th>
      </tr></thead><tbody>{playerRows.map((player, index) => <tr key={`${player.game.eventId}:${player.playerId}:${player.stat}`}>
        <th scope="row">{index + 1}. {player.name}<small>{player.position} · {player.team} · {player.game.away.abbr} – {player.game.home.abbr}</small></th>
        <td>{number(player.projected)}</td><td>{player.actual}</td><td>{number(player.error)}</td>
      </tr>)}</tbody></table></div> : <p>No eligible reported actuals for {simulationAccuracyStats[stat].toLowerCase()} yet.</p>}
      </div>
      </section>
      </div>
      <p>Not sportsbook lines or bet grades. Player comparisons never mix units or count missing/DNP stats as zero. Regulation-only projections exclude overtime or unverified regulation actuals.</p>
      {(report.issues.length > 0 || report.games.some(game => game.issues.length > 0)) && <details><summary>Coverage and exclusions</summary>
        {report.issues.map(issue => <p key={issue}>{issue}</p>)}
        {report.games.map(game => game.issues.map(issue => <p key={`${game.eventId}:${issue}`}>{game.away.abbr} – {game.home.abbr}: {issue}</p>))}
      </details>}
    </>}
  </section>;
}
