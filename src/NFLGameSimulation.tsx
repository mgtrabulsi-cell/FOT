import { useEffect, useState } from 'react';
import type { Game } from './services/sportsData';
import { loadGameSimulation } from './services/gamewireBot';
import type { NFLGameSimulation, SimulationTeamResult } from '../supabase/functions/_shared/nflSimulation';

function TeamSimulation({ team }: { team: SimulationTeamResult }) {
  const columns = [['passingYards', 'Pass YDS'], ['rushingYards', 'Rush YDS'], ['receivingYards', 'Rec YDS'], ['receptions', 'REC']] as const;
  return (
    <section className="nfl-simulation-team">
      <h3>{team.name}</h3>
      <div className="nfl-simulation-table-scroll" tabIndex={0} role="region" aria-label={`${team.name} simulated player statistics`}>
        <table>
          <caption>Expected production, with 10th–90th percentile ranges</caption>
          <thead><tr><th scope="col">Player</th>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
          <tbody>{team.players.map(player => (
            <tr key={player.id}>
              <th scope="row">
                <b>{player.name}</b><small>{player.position} · {player.games} verified games{player.priorTeams.some(id => id !== team.id) ? ' · Includes prior teams' : ''}</small>
                {player.headToHeadGames > 0 && <small>{player.headToHeadGames} against this opponent</small>}
                <small>{player.status}</small>
                {player.issue && <small className="nfl-simulation-issue">{player.issue}</small>}
              </th>
              {columns.map(([key]) => {
                const stat = player.stats[key];
                return <td key={key}>{stat ? <><b>{stat.mean}</b><small>{stat.p10}–{stat.p90}</small></> : <span aria-label="Unavailable">—</span>}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="nfl-simulation-remainder">Team remainder: {team.totals.otherReceivingYards.mean} receiving yards, {team.totals.otherReceptions.mean} catches, {team.totals.otherRushingYards.mean} rushing yards for unmodeled players. Missing individual evidence is not filled with zero.</p>
    </section>
  );
}

export default function NFLGameSimulationPanel({ game }: { game: Game }) {
  const [response, setResponse] = useState<NFLGameSimulation | null>(null);
  const [forecast, setForecast] = useState<NFLGameSimulation | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [scenarioId, setScenarioId] = useState('');
  const [locked, setLocked] = useState(Date.parse(game.date) <= Date.now());
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      const delay = Date.parse(game.date) - Date.now();
      setLocked(delay <= 0);
      if (delay > 0) timer = window.setTimeout(check, Math.min(delay, 2147483647));
    };
    check();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [game.date]);
  useEffect(() => {
    if (locked) return;
    const controller = new AbortController();
    let timer: number | undefined, attempts = 0;
    setError('');
    const load = async () => {
      setLoading(true);
      try {
        const result = await loadGameSimulation(game, controller.signal);
        if (controller.signal.aborted) return;
        setResponse(result);
        if (result.status === 'ready') setForecast(result);
        if (result.status === 'unavailable') setForecast(null);
        if (result.status === 'collecting') {
          if (++attempts < 30) timer = window.setTimeout(() => { void load(); }, 10000);
          else setError('This backfill needs more time. Shared server work continues; use Retry to check progress. Saved evidence is retained.');
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error('NFL game simulation failed', game.eventId, cause);
        setError(cause instanceof Error ? cause.message : 'The NFL simulation could not load. Retry.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [game.eventId, game.date, game.home.id, game.away.id, retry, locked]);
  const displayed = forecast ?? (response?.status === 'unavailable' ? response : null);
  const scenario = displayed?.scenarios.find(row => row.id === scenarioId)
    ?? displayed?.scenarios.find(row => row.home && row.away) ?? displayed?.scenarios[0];
  return (
    <section className="nfl-simulation" aria-labelledby="nfl-simulation-heading">
      <header className="nfl-simulation-header">
        <div><h2 id="nfl-simulation-heading">GamewAIre Game Simulation</h2><p>Experimental · Production across teams · Not a betting recommendation</p></div>
        {!locked && <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{error ? 'Retry' : 'Refresh'}</button>}
      </header>
      {locked && <p role="status">Kickoff has passed. This pregame simulator is locked; no new forecast will be generated.</p>}
      {error && <p className="feed-warning" role="alert">{error}{forecast && ' Your last verified forecast remains below.'}</p>}
      {!response && !error && !locked && <p role="status">Preparing verified team history and current roster availability…</p>}
      {response?.status === 'collecting' && !locked && (
        <div className="nfl-simulation-progress" role="status">
          <b>{response.stage}: {response.progress.completed}/{response.progress.total}</b>
          <progress max={Math.max(1, response.progress.total)} value={response.progress.completed} aria-label={response.stage} />
          <small>{game.away.abbr}: {response.history.away}/100 team games · {game.home.abbr}: {response.history.home}/100 team games</small>
          <p>First-time history is collected in saved batches. This view checks automatically; the server also prepares upcoming games in the background.</p>
          {response.warnings.length > 0 && <details><summary>Evidence issues ({response.warnings.length})</summary><ul>{response.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        </div>
      )}
      {displayed && (
        <>
          <label className="nfl-simulation-scenario">Quarterback scenario — participation assumed, not confirmed
            <select value={scenario?.id ?? ''} onChange={event => setScenarioId(event.target.value)}>
              {displayed.scenarios.map(row => <option key={row.id} value={row.id}>{row.label}{row.issue ? ' — Insufficient evidence' : ''}</option>)}
            </select>
          </label>
          {scenario?.issue && <p className="feed-warning" role="status">{scenario.issue}</p>}
          {scenario?.home && scenario.away && (
            <>
              <div className="nfl-simulation-scores">
                {[scenario.away, scenario.home].map(team => <div key={team.id}><b>{team.abbr}</b><strong>{Math.round(team.score.mean)}</strong><span>{team.score.p10}–{team.score.p90} point range</span><small>Outscored opponent in {(team.winProbability * 100).toFixed(1)}% of draws</small></div>)}
              </div>
              <p className="nfl-simulation-caption">Mean simulated score (rounded) · {displayed.runs.toLocaleString()} joint draws · {((scenario.tieProbability ?? 0) * 100).toFixed(1)}% tied-score draws; overtime is not separately simulated.</p>
              <div className="nfl-simulation-teams"><TeamSimulation team={scenario.away} /><TeamSimulation team={scenario.home} /></div>
            </>
          )}
          <p className="nfl-simulation-caption">Availability checked {new Date(displayed.checkedAt).toLocaleString()} · Forecast saved {new Date(displayed.forecastAt!).toLocaleString()} · 100 completed regular-season/playoff games per team.</p>
          <details className="nfl-simulation-method"><summary>Roster availability and model limitations</summary>
            <p>Questionable players are assumed to participate at observed usage. Listed out/inactive players are excluded. Offensive-line and defensive injury impacts are not numerically estimated without validated participation evidence.</p>
            {displayed.injuries.length ? <ul>{displayed.injuries.map((injury, i) => <li key={i}>{injury.name} ({injury.position}, {injury.teamId === game.home.id ? game.home.abbr : game.away.abbr}): {injury.status}</li>)}</ul> : <p>No concerns reported in the roster response; this is not a complete confirmed game-day injury report.</p>}
            <ul>{displayed.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
          </details>
        </>
      )}
    </section>
  );
}
