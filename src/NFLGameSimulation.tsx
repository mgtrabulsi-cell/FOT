import { useEffect, useState } from 'react';
import type { Game } from './services/sportsData';
import { loadGameSimulation } from './services/gamewireBot';
import { legacyNFLSimulationVersion, roundedSimulationBox } from '../supabase/functions/_shared/nflSimulation';
import type { NFLGameSimulation, SimulationStat, SimulationTeamResult } from '../supabase/functions/_shared/nflSimulation';

const statLabels: Record<keyof SimulationStat, string> = {
  passingAttempts: 'ATT', completions: 'CMP', passingYards: 'PASS YDS', passingTouchdowns: 'PASS TD',
  rushingAttempts: 'ATT', rushingYards: 'RUSH YDS', rushingTouchdowns: 'RUSH TD',
  receptions: 'REC', receivingYards: 'REC YDS', receivingTouchdowns: 'REC TD',
};
const groups: Array<{ title: string; positions: string[]; columns: Array<keyof SimulationStat> }> = [
  { title: 'Passing', positions: ['QB'], columns: ['completions', 'passingAttempts', 'passingYards', 'passingTouchdowns', 'rushingYards', 'rushingTouchdowns'] },
  { title: 'Backfield', positions: ['RB'], columns: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns'] },
  { title: 'Receiving', positions: ['WR', 'TE'], columns: ['receptions', 'receivingYards', 'receivingTouchdowns'] },
];

function TeamSimulation({ team }: { team: SimulationTeamResult }) {
  const box = roundedSimulationBox(team);
  return (
    <section className="nfl-simulation-team">
      <header className="nfl-simulation-team-title"><span>{team.abbr}</span><h3>{team.name}</h3><b>{box.score}</b></header>
      {groups.map(group => {
        const players = team.players.filter(player => group.positions.includes(player.position));
        if (!players.length) return null;
        return <div className="nfl-simulation-table-scroll" key={group.title} tabIndex={0} role="region" aria-label={`${team.name} ${group.title.toLowerCase()} projections`}>
          <table>
            <caption>{group.title} · Projected stat line</caption>
            <thead><tr><th scope="col">Player</th>{group.columns.map(key => <th scope="col" key={key}>{statLabels[key]}</th>)}</tr></thead>
            <tbody>{players.map(player => <tr key={player.id} className={player.issue ? 'nfl-simulation-unavailable' : undefined}>
              <th scope="row"><b>{player.name}</b><small>{player.position}{player.issue ? ' · Unavailable' : ''}</small></th>
              {group.columns.map(key => <td key={key}>{box.players[player.id][key] !== undefined
                ? <b>{box.players[player.id][key]}</b> : <span aria-label="No supported projection">—</span>}</td>)}
            </tr>)}</tbody>
          </table>
        </div>;
      })}
      <details className="nfl-simulation-stat-details">
        <summary>Expected values, ranges & player evidence</summary>
        <p>Whole-number lines are rounded and reconciled across the team. A projected 0 TD does not mean a zero chance of scoring. Dashes mean no supported projection, not zero production.</p>
        {team.players.map(player => <article key={player.id}>
          <h4>{player.name} · {player.position}</h4>
          <p>{player.games} verified games{player.priorTeams.some(id => id !== team.id) ? ' · Includes prior teams' : ''}
            {player.headToHeadGames > 0 ? ` · ${player.headToHeadGames} against this opponent` : ''}</p>
          <p>{player.status} · {player.role}</p>
          {player.issue && <p className="nfl-simulation-issue">{player.issue}</p>}
          <dl>{Object.entries(player.stats).map(([key, stat]) => <div key={key}>
            <dt>{statLabels[key as keyof SimulationStat]}</dt><dd>Expected {stat!.mean.toFixed(2)} · 10th–90th: {stat!.p10}–{stat!.p90}</dd>
          </div>)}</dl>
        </article>)}
        <p className="nfl-simulation-remainder">Unmodeled-player remainder: {box.remainder.otherReceivingYards} receiving yards, {box.remainder.otherReceptions} catches,
          {' '}{box.remainder.otherRushingYards} rushing yards
          {box.remainder.otherReceivingTouchdowns !== undefined ? `, ${box.remainder.otherReceivingTouchdowns} receiving TD, ${box.remainder.otherRushingTouchdowns} rushing TD` : ''}.
          Missing individual evidence is not filled with zero.</p>
      </details>
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
        if (result.status === 'collecting' || result.refreshing) {
          if (++attempts < 60) timer = window.setTimeout(() => { void load(); }, result.status === 'collecting' ? 30000 : 60000);
          else if (result.status === 'collecting') setError('Background preparation is still running. Check again shortly; no page needs to stay open. Saved evidence is retained.');
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
      {!response && !error && !locked && <p role="status">Loading the saved GamewAIre simulation…</p>}
      {displayed?.refreshing && !locked && <p className="nfl-simulation-caption" role="status">Showing the saved forecast while automatic background preparation updates it.</p>}
      {displayed?.version === legacyNFLSimulationVersion && <p role="status">This earlier forecast has no touchdown estimates. The updated projected box score is being prepared in the background.</p>}
      {response?.status === 'collecting' && !locked && (
        <div className="nfl-simulation-progress" role="status">
          <b>{response.stage}: {response.progress.completed}/{response.progress.total}</b>
          <progress max={Math.max(1, response.progress.total)} value={response.progress.completed} aria-label={response.stage} />
          <small>{game.away.abbr}: {response.history.away}/100 team games · {game.home.abbr}: {response.history.home}/100 team games</small>
          <p>The server automatically prepares the upcoming NFL week. This view only checks saved progress; preparation continues even if you close it.</p>
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
                {[scenario.away, scenario.home].map(team => <div key={team.id}><b>{team.abbr}</b><strong>{roundedSimulationBox(team).score}</strong><span>{team.name}</span></div>)}
              </div>
              <p className="nfl-simulation-caption">Projected final score · Rounded stat lines · {displayed.runs.toLocaleString()} joint draws</p>
              <details className="nfl-simulation-score-details"><summary>Score expectations & ranges</summary>
                {[scenario.away, scenario.home].map(team => <p key={team.id}>{team.abbr}: expected {team.score.mean.toFixed(2)} points · 10th–90th: {team.score.p10}–{team.score.p90} · Outscored opponent in {(team.winProbability * 100).toFixed(1)}% of draws</p>)}
                <p>{((scenario.tieProbability ?? 0) * 100).toFixed(1)}% tied-score draws; overtime is not separately simulated.</p>
              </details>
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
