import { useEffect, useState } from 'react';
import type { Game } from './services/sportsData';
import { loadGameSimulation } from './services/gamewireBot';
import { supabase } from './services/supabaseClient';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { renderSimulationGraphic } from './services/nflSimulationGraphic';
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
  if (team.totals === null) return null;
  const box = roundedSimulationBox({ ...team, totals: team.totals });
  return (
    <section className="nfl-simulation-team">
      <header className="nfl-simulation-team-title"><span>{team.abbr}</span><h3>{team.name}</h3><b>{box.score}</b></header>
      {groups.map(group => {
        const players = team.players.filter(player => group.positions.includes(player.position));
        if (group.title === 'Receiving') players.sort((a, b) =>
          (box.players[b.id].receptions ?? -1) - (box.players[a.id].receptions ?? -1)
          || (box.players[b.id].receivingYards ?? -1) - (box.players[a.id].receivingYards ?? -1)
          || a.name.localeCompare(b.name));
        if (!players.length) return null;
        return <div className="nfl-simulation-table-scroll" key={group.title} tabIndex={0} role="region" aria-label={`${team.name} ${group.title.toLowerCase()} projections`}>
          <table>
            <caption>{group.title} · Projected stat line{group.title === 'Receiving' ? ' · Most receptions first' : ''}</caption>
            <thead><tr><th scope="col">Player</th>{group.columns.map(key => <th scope="col" key={key}>{statLabels[key]}</th>)}</tr></thead>
            <tbody>{players.map(player => <tr key={player.id} className={player.issue ? 'nfl-simulation-unavailable' : undefined}>
              <th scope="row"><b>{player.name}</b><small>{player.position}{player.issue ? ' · Unavailable' : ''}</small></th>
              {group.columns.map(key => <td key={key}>{box.players[player.id][key] !== undefined
                ? <b>{box.players[player.id][key]}</b> : <span aria-label="No supported projection">—</span>}</td>)}
            </tr>)}</tbody>
          </table>
        </div>;
      })}
      <details className="nfl-simulation-accounting" aria-label={`${team.name} projected team totals and score accounting`}>
        <summary>Team totals &amp; score accounting</summary>
        <dl>
          <div><dt>PASS / REC YDS</dt><dd>{box.totals.passingYards !== null
            ? <><b>{box.totals.passingYards}</b> pass = <b>{box.listed.receivingYards}</b> WR/TE/RB receiving{box.remainder.otherReceivingYards ? <> + <b>{box.remainder.otherReceivingYards}</b> unallocated receiving</> : null}</>
            : 'Passing/receiving accounting unavailable.'}</dd></div>
          <div><dt>CMP / REC</dt><dd>{box.totals.completions !== null
            ? <><b>{box.totals.completions}</b> completions = <b>{box.listed.receptions}</b> listed catches{box.remainder.otherReceptions ? <> + <b>{box.remainder.otherReceptions}</b> unallocated catches</> : null}</>
            : 'Completion/reception accounting unavailable.'}</dd></div>
          <div><dt>RUSH YDS</dt><dd><b>{box.totals.rushingYards}</b> total = <b>{box.listed.rushingYards}</b> listed + <b>{box.remainder.otherRushingYards}</b> other rushing</dd></div>
          {box.scoring && <>
            <div><dt>PASS / REC TD</dt><dd><b>{box.totals.passingTouchdowns}</b> passing = <b>{box.listed.receivingTouchdowns}</b> listed receiving + <b>{box.remainder.otherReceivingTouchdowns}</b> other receiving</dd></div>
            <div><dt>RUSH TD</dt><dd><b>{box.totals.rushingTouchdowns}</b> total = <b>{box.listed.rushingTouchdowns}</b> listed + <b>{box.remainder.otherRushingTouchdowns}</b> other rushing</dd></div>
            <div className="nfl-simulation-points-line"><dt>PROJECTED SCORE</dt><dd><b>{box.score}</b> = 6 x (<b>{box.totals.passingTouchdowns}</b> passing TD + <b>{box.totals.rushingTouchdowns}</b> rushing TD) + <b>{box.scoring.otherPoints}</b> other points</dd></div>
          </>}
        </dl>
        <p>Receiving yards and catches are allocated across supported listed targets by projected share, giving higher-production targets more of the remainder. Without supported targets, production stays unallocated; missing player stats are never invented. Other rushing production remains a team remainder.</p>
        {box.scoring ? <p>Passing and receiving TDs count once. Other points are an unattributed scoring remainder that may include extra points, field goals, conversions, safeties or defensive scores; no kicker stat line or specific scoring breakdown is inferred.</p>
          : <p>Touchdown and scoring-point accounting is unavailable for this older forecast.</p>}
      </details>
    </section>
  );
}

function TeamEvidence({ team }: { team: SimulationTeamResult }) {
  return <details className="nfl-simulation-stat-details">
        <summary>Expected values, ranges & player evidence</summary>
        {team.matchup && <p>Opponent pass-defense adjustment: {team.matchup.passingYardsMultiplier >= 1 ? '+' : ''}{((team.matchup.passingYardsMultiplier - 1) * 100).toFixed(1)}% to receiving-yard efficiency. Historical allowance adjustment, not a guaranteed outcome.</p>}
        <p>Whole-number lines allocate the receiving remainder across supported listed targets by projected share; the underlying expected values and ranges below are before that allocation. A projected 0 TD does not mean a zero chance of scoring. Dashes mean no supported projection, not zero production.</p>
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
      </details>;
}

export default function NFLGameSimulationPanel({ game, initialSimulation, onForecast, onScenarioChange }: { game: Game; initialSimulation?: NFLGameSimulation; onForecast?: (forecast: NFLGameSimulation) => void; onScenarioChange?: (scenarioId: string) => void }) {
  const [response, setResponse] = useState<NFLGameSimulation | null>(initialSimulation ?? null);
  const [forecast, setForecast] = useState<NFLGameSimulation | null>(initialSimulation?.status === 'ready' ? initialSimulation : null);
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
    let timer: number | undefined, attempts = 0, failures = 0, inFlight = false;
    setError('');
    setResponse(previous => previous?.eventId === game.eventId && Date.parse(previous.kickoff) === Date.parse(game.date) ? previous : null);
    setForecast(previous => previous?.eventId === game.eventId && Date.parse(previous.kickoff) === Date.parse(game.date) ? previous : null);
    const load = async () => {
      if (inFlight || controller.signal.aborted || Date.parse(game.date) <= Date.now()) return;
      inFlight = true;
      setLoading(true);
      try {
        const result = await loadGameSimulation(game, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        setError('');
        setResponse(result);
        if (result.status === 'ready') onForecast?.(result);
        if (result.status === 'ready') setForecast(result);
        const delay = ++attempts >= 60 || result.status === 'ready' && !result.refreshing ? 300000 : result.status === 'collecting' ? 30000 : 60000;
        timer = window.setTimeout(() => { void load(); }, delay);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error('NFL game simulation failed', game.eventId, cause);
        setError(cause instanceof Error ? cause.message : 'The NFL simulation could not load. Retry.');
        const delay = Math.min(300000, 15000 * 2 ** Math.min(failures++, 5));
        timer = window.setTimeout(() => { void load(); }, delay);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const reconnect = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      failures = 0;
      void load();
    };
    window.addEventListener('online', reconnect);
    void load();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener('online', reconnect); };
  }, [game.eventId, game.date, game.home.id, game.away.id, retry, locked, onForecast]);
  const displayed = forecast;
  const scenario = displayed?.scenarios.find(row => row.id === scenarioId)
    ?? displayed?.scenarios.find(row => row.home && row.away) ?? displayed?.scenarios[0];
  useEffect(() => { if (scenario) onScenarioChange?.(scenario.id); }, [scenario?.id, onScenarioChange]);
  const [admin, setAdmin] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(game.away.id);
  const selectedTeam = scenario?.home?.id === selectedTeamId ? scenario.home : scenario?.away;
  useEffect(() => {
    if (!supabase) return;
    let active = true, revision = 0;
    const check = async () => {
      const current = ++revision;
      setAdmin(false);
      const permission = await supabase!.rpc('gamewaire_can_admin');
      if (permission.error) {
        console.error('Could not verify simulation diagnostics permissions', permission.error);
        return;
      }
      if (active && current === revision) setAdmin(permission.data === true);
    };
    const refresh = () => { void check().catch(cause => { console.error('Could not load simulation diagnostics permissions', cause); }); };
    refresh();
    const { data } = supabase.auth.onAuthStateChange(() => { ++revision; setAdmin(false); window.setTimeout(() => { if (active) refresh(); }, 0); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return (
    <section className="nfl-simulation" aria-labelledby="nfl-simulation-heading">
      {scenario?.home && scenario.away && <div className="nfl-simulation-scores" aria-label="Projected final score">
        {[scenario.away, scenario.home].map(team => <div key={team.id}><b>{team.abbr}</b><strong>{Math.round(team.score.mean)}</strong><span>{team.name}</span></div>)}
      </div>}
      <header className="nfl-simulation-header">
        <div><h2 id="nfl-simulation-heading">GamewAIre Game Simulation</h2><p>Experimental · Production across teams · Not a betting recommendation</p></div>
        {!locked && <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{error ? 'Retry' : 'Refresh'}</button>}
      </header>
      {locked && <p role="status">Kickoff has passed. This pregame simulator is locked; no new forecast will be generated.</p>}
      {error && !displayed && <div className="nfl-simulation-caption">
        <p role="status">{forecast ? 'Your saved simulation remains available while updates reconnect.' : 'Preparing your simulation. A feed interruption is delaying updates.'} Automatic retries continue, including when your connection returns.</p>
      </div>}
      {!response && !error && !locked && <p role="status">Loading the saved GamewAIre simulation…</p>}
      {!displayed && response && !error && !locked && <p role="status">Preparing your GamewAIre simulation. Updates load automatically.</p>}
      {displayed && (
        <>
          {displayed.evidenceMode !== 'team-only' && <label className="nfl-simulation-scenario">Quarterback scenario — participation assumed, not confirmed
            <select value={scenario?.id ?? ''} onChange={event => setScenarioId(event.target.value)}>
              {displayed.scenarios.map(row => <option key={row.id} value={row.id}>{row.label}{row.issue ? ' — Preparing' : ''}</option>)}
            </select>
          </label>}
          {scenario?.issue && <p role="status">This quarterback scenario is not available yet.</p>}
          {scenario?.home && scenario.away && (
            <>
              <p className="nfl-simulation-caption">Projected final score · {displayed.evidenceMode === 'team-only' ? 'Verified final-score history' : 'Rounded stat lines'} · {displayed.runs.toLocaleString()} joint draws</p>
              {admin && <div className="nfl-simulation-graphic-downloads">
              <ResultsGraphicDownload key={`${game.eventId}-${scenario.id}`} label="Download game graphic" disabled={false}
                generate={() => renderSimulationGraphic(scenario, game.date, { away: game.away.color, home: game.home.color })}
                filename={`GameWire-Simulation-${scenario.away.abbr}-${scenario.home.abbr}-${game.eventId}.png`}
                snapshotNote="Snapshot from your last download. Download again after the simulation updates."
                description="1600 x 1000 PNG: both scores, QBs, top RB by carries and top two receivers by receptions. Uses the selected QB scenario; unavailable stats stay blank."
                alt={`${scenario.away.name} vs ${scenario.home.name} simulated scores and player projections`} />
              <ResultsGraphicDownload key={`instagram-${game.eventId}-${scenario.id}`} label="Download Instagram graphic" disabled={false}
                generate={() => renderSimulationGraphic(scenario, game.date, { away: game.away.color, home: game.home.color }, 'instagram')}
                filename={`GameWire-Simulation-${scenario.away.abbr}-${scenario.home.abbr}-${game.eventId}-Instagram.png`}
                description="Instagram portrait PNG (1080 x 1350). Same projections, with larger stat blocks arranged for the portrait layout."
                snapshotNote="Snapshot from your last download. Download again after the simulation updates."
                alt={`${scenario.away.name} vs ${scenario.home.name} Instagram simulation graphic`} />
              </div>}
              <details className="nfl-simulation-score-details"><summary>Score expectations & ranges</summary>
                {[scenario.away, scenario.home].map(team => <p key={team.id}>{team.abbr}: expected {team.score.mean.toFixed(2)} points · 10th–90th: {team.score.p10}–{team.score.p90} · Outscored opponent in {(team.winProbability * 100).toFixed(1)}% of draws</p>)}
                <p>{((scenario.tieProbability ?? 0) * 100).toFixed(1)}% tied-score draws; overtime is not separately simulated.</p>
              </details>
              {displayed.evidenceMode === 'team-only' ? <p className="nfl-simulation-caption">Player stat lines, touchdown accounting and numerical starter/injury adjustments are not supported by the available evidence. No missing player production is filled with zeros.</p>
                : selectedTeam && <div className="nfl-simulation-teams">
                    <div className="nfl-simulation-team-switch" role="group" aria-label="Projected box score team">
                      {[scenario.away, scenario.home].map(team => <button key={team.id} type="button"
                        aria-pressed={selectedTeam.id === team.id} onClick={() => setSelectedTeamId(team.id)}>
                        <span>{team.abbr}</span><b>{team.name}</b>
                      </button>)}
                    </div>
                    <div role="region" aria-label={`${selectedTeam.name} projected box score`}>
                      <TeamSimulation key={selectedTeam.id} team={selectedTeam} />
                    </div>
                  </div>}
            </>
          )}
        </>
      )}
      {admin && (response || error) && <details className="nfl-simulation-method"><summary>Admin: preparation, history &amp; evidence</summary>
          {error && <p className="nfl-simulation-issue" role="status">Update issue: {error}. Saved projections remain available; automatic retries continue.</p>}
          {response && <div className="nfl-simulation-progress">
            <b>{response.stage}: {response.progress.completed}/{response.progress.total}</b>
            <progress max={Math.max(1, response.progress.total)} value={response.progress.completed} aria-label={response.stage} />
            <small>{game.away.abbr}: {response.history.away}/100 team games · {game.home.abbr}: {response.history.home}/100 team games</small>
            <p>The server automatically prepares the upcoming NFL week. Preparation continues even if you close it.</p>
            <ul>{response.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
          </div>}
          {displayed && <>
          {scenario?.issue && <p>{scenario.issue}</p>}
          <p className="nfl-simulation-caption">Evidence checked {new Date(displayed.checkedAt).toLocaleString()} · Forecast saved {new Date(displayed.forecastAt!).toLocaleString()} · {displayed.history.home} home-team / {displayed.history.away} away-team completed games (target: 100 each).</p>
          {displayed.evidenceMode && <p>Coverage: {displayed.evidenceMode}. {displayed.refreshing ? 'Additional history is collecting.' : 'Collection complete.'}</p>}
          {displayed.version === legacyNFLSimulationVersion && <p>This earlier forecast has no touchdown estimates.</p>}
            <p>Questionable players are assumed to participate at observed usage. Listed out/inactive players are excluded. Offensive-line and defensive injury impacts are not numerically estimated without validated participation evidence.</p>
            {displayed.injuries.length ? <ul>{displayed.injuries.map((injury, i) => <li key={i}>{injury.name} ({injury.position}, {injury.teamId === game.home.id ? game.home.abbr : game.away.abbr}): {injury.status}</li>)}</ul> : <p>No complete confirmed game-day injury report is available. Refer to evidence issues for source availability.</p>}
            {scenario?.away && <TeamEvidence team={scenario.away} />}
            {scenario?.home && <TeamEvidence team={scenario.home} />}
          </>}
          </details>}
    </section>
  );
}
