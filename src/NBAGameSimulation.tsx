import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import TeamAbbrMark from './TeamAbbrMark';
import DraggableTabs from './DraggableTabs';
import { ResultsGraphicDownload } from './GamewaireResultsDownload';
import { useSimulationGraphicAccess } from './useSimulationGraphicAccess';
import { nbaDailyPerformers } from '../supabase/functions/_shared/nbaSimulation';
import type { NBAAccuracyReport, NBAGameSimulation, NBAPlayerProjection } from '../supabase/functions/_shared/nbaSimulation';
import { loadNBAAccuracy, loadNBASimulation } from './services/nbaSimulation';
import { renderNBASimulationGraphic } from './services/nbaSimulationGraphic';
import type { Game } from './services/sportsData';

const value = (n: number) => n.toFixed(1);
const stamp = (time: string) => new Date(time).toLocaleString();
const line = (player: NBAPlayerProjection) => `${value(player.stats.points.mean)} PTS / ${value(player.stats.rebounds.mean)} REB / ${value(player.stats.assists.mean)} AST`;
function NBAGraphicDownload({ generate, ...props }: Omit<ComponentProps<typeof ResultsGraphicDownload>, 'generate'> & {
  generate: (signal: AbortSignal) => Promise<Blob>;
}) {
  const access = useSimulationGraphicAccess(), requests = useRef(new Set<AbortController>());
  useEffect(() => () => { for (const controller of requests.current) controller.abort(); }, [access.allowed]);
  if (!access.allowed) return access.error ? <p role="alert">{access.error}</p> : null;
  return <ResultsGraphicDownload {...props} generate={async () => {
    if (!access.allowed) throw new Error('NBA simulation graphics are restricted to the owner and admins.');
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const blob = await generate(controller.signal);
      controller.signal.throwIfAborted();
      return blob;
    } finally { requests.current.delete(controller); }
  }} />;
}
function ForecastStatus({ forecast, error }: { forecast?: NBAGameSimulation; error?: string }) {
  return <>{error && <p className="feed-warning" role="alert">{error}</p>}
    {forecast?.status !== 'ready' && <p role="status">{forecast?.stage ?? 'Loading saved NBA simulation...'}</p>}
    {forecast?.status !== 'ready' && forecast && <progress aria-label="NBA historical games prepared" value={forecast.progress.completed} max={forecast.progress.total} />}</>;
}
export function NBADailyPerformers({ forecasts, games, date }: { forecasts: NBAGameSimulation[]; games: Game[]; date: string }) {
  const players = nbaDailyPerformers(forecasts, date);
  const covered = games.filter(game => forecasts.some(row => row.eventId === game.eventId && row.status === 'ready'
    && Date.parse(row.kickoff) === Date.parse(game.date))).length;
  const generate = async (signal: AbortSignal) => {
    const refreshed = await Promise.all(games.map(game => loadNBASimulation(game, signal)));
    const leaders = nbaDailyPerformers(refreshed, date);
    return renderNBASimulationGraphic('The Daily Triple / Top 3 PRA', `${date} | ${refreshed.filter(row => row.status === 'ready').length}/${games.length} games ready`,
      leaders.map((player, index) => ({ title: `#${index + 1} ${player.name} | ${player.team} vs ${player.opponent}`,
        detail: `${value(player.stats.pra.mean)} projected PRA | ${player.status}`,
        line: line(player), note: `Saved ${stamp(player.forecastAt!)} | ${player.games} appearances${player.limited ? ' | Limited sample' : ''}` })));
  };
  return <section className="nba-simulation-leaders" aria-label="Daily top three projected PRA performers">
    <header><span className="eyebrow">THE DAILY TRIPLE</span><h3>Daily projected PRA leaders</h3></header>
    <p className="nba-note">{date} · Points + rebounds + assists · {covered}/{games.length} games ready.
      {covered < games.length ? ' Provisional leaders; preparing games may change this list.' : ' Ranked across the complete selected slate.'}</p>
    <div className="nba-simulation-leader-grid">{players.map((player, index) => <article key={player.id}>
      <span className="eyebrow">#{index + 1} · {player.team} vs {player.opponent}</span><h4>{player.name}</h4>
      <strong>{value(player.stats.pra.mean)} <small>projected PRA</small></strong><p>{line(player)}</p>
      <small>{value(player.stats.minutes.mean)} MIN · {player.status}{player.limited ? ' · Limited sample' : ''}</small>
      <details><summary>Matchup &amp; range</summary><p>{player.matchup}</p>
        <small>P10–P90: {value(player.stats.pra.p10)}–{value(player.stats.pra.p90)} PRA</small></details>
    </article>)}</div>
    {!players.length && <p role="status">No supported player projections yet. The background preparation refreshes automatically.</p>}
    <small>Conditional on playing. Usage-ranked players, not confirmed starters. Experimental estimates, not betting recommendations.</small>
    <NBAGraphicDownload generate={generate} disabled={!players.length} filename={`GameWire-NBA-Daily-Triple-${date}.png`}
      label="Download · Daily Triple" description="Refreshes the full selected slate before ranking the top three"
      alt="NBA top three players by projected points plus rebounds plus assists" />
  </section>;
}
export default function NBAGameSimulation({ game, forecast, error }: { game: Game; forecast?: NBAGameSimulation; error?: string }) {
  const [stat, setStat] = useState<'pra' | 'points' | 'rebounds' | 'assists'>('pra');
  const ready = forecast?.status === 'ready' && forecast.home && forecast.away;
  const generate = async (signal: AbortSignal) => {
    const refreshed = await loadNBASimulation(game, signal);
    if (refreshed.status !== 'ready') throw new Error('NBA game simulation is not ready to export.');
    return renderNBASimulationGraphic(`${game.away.abbr} at ${game.home.abbr}`, `Pregame forecast | Saved ${stamp(refreshed.forecastAt!)}`,
      [refreshed.away!, refreshed.home!].flatMap(team => [
        { title: `${team.name} | ${value(team.score.mean)} projected points`, detail: `${(team.winProbability * 100).toFixed(1)}% simulated win share`,
          line: `${value(team.pace)} sampled possessions | ${team.players.length} supported players`,
          note: `${refreshed.history[team.id === refreshed.homeTeamId ? 'home' : 'away']}/100 historical games | ${refreshed.lockedAt ? 'Locked' : 'Refreshing pregame'}` },
        ...team.players.map(player => ({ title: player.name, detail: `${player.position} | ${player.status} | ${player.games} sampled appearances`,
          line: `${line(player)} | ${value(player.stats.pra.mean)} PRA`, note: `${value(player.stats.minutes.mean)} MIN | ${player.limited ? 'Limited sample' : 'Personal game evidence'} | Not a confirmed starter` })),
      ]));
  };
  return <section className="nba-simulation-panel" aria-label="NBA GamewAIre simulation">
    <header><span className="eyebrow">GAMEWAIRE / NBA SIMULATION</span><h3>{game.away.abbr} at {game.home.abbr}</h3></header>
    <ForecastStatus forecast={forecast} error={error} />
    {ready && <>
      <div className="nba-simulation-score">{[forecast.away!, forecast.home!].map(team => <div key={team.id}>
        <TeamAbbrMark abbr={team.abbr} name={team.name} color={team.id === game.home.id ? game.home.color : game.away.color} />
        <b>{team.abbr}</b><strong>{value(team.score.mean)}</strong><small>{(team.winProbability * 100).toFixed(1)}% simulated win share</small>
        <small>P10–P90 {value(team.score.p10)}–{value(team.score.p90)}</small>
      </div>)}</div>
      <p className="nba-note">{forecast.runs.toLocaleString()} joint resamples · {forecast.history.away}/{forecast.history.home} historical team games
        · Saved {stamp(forecast.forecastAt!)} · {forecast.lockedAt ? 'Pregame locked; only verified availability changes may revise before tipoff' : 'Automatic pregame refresh every 10 minutes'}
        {forecast.refreshing ? ' · Backfill / refresh continues' : ''}</p>
      <DraggableTabs className="nfl-player-stat-tabs" ariaLabel="NBA projected player statistics" selected={stat} onSelect={setStat}
        options={[{ key: 'pra', label: 'PRA' }, { key: 'points', label: 'Points' }, { key: 'rebounds', label: 'Rebounds' }, { key: 'assists', label: 'Assists' }]} />
      {[forecast.away!, forecast.home!].map(team => <section key={team.id}><h4>{team.name} · Usage-based rotation</h4>
        <div className="nba-table-scroll" role="region" aria-label={`${team.name} projected player statistics`} tabIndex={0}>
          <table className="nba-table"><thead><tr><th>Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>PRA</th><th>{stat.toUpperCase()} P10–P90</th></tr></thead>
            <tbody>{[...team.players].sort((a, b) => b.stats[stat].mean - a.stats[stat].mean || a.id.localeCompare(b.id)).map(player =>
              <tr key={player.id}><th scope="row">{player.name}<small>{player.position} · {player.status}{player.limited ? ' · Limited sample' : ''}</small></th>
                <td>{value(player.stats.minutes.mean)}</td><td>{value(player.stats.points.mean)}</td><td>{value(player.stats.rebounds.mean)}</td><td>{value(player.stats.assists.mean)}</td>
                <td><b>{value(player.stats.pra.mean)}</b></td><td>{value(player.stats[stat].p10)}–{value(player.stats[stat].p90)}</td></tr>)}</tbody></table>
        </div>{!team.players.length && <p>No players have sufficient verified personal evidence.</p>}
      </section>)}
      <NBAGraphicDownload generate={generate} disabled={false} filename={`GameWire-NBA-Simulation-${game.eventId}.png`}
        label="Download NBA simulation" description="Projected team scores and all supported player lines" alt="NBA game simulation with projected player points rebounds assists and PRA" />
      <details><summary>Model, availability &amp; data notes</summary>{forecast.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
        <p>Learning corrections activate only after 30 training games and 10 held-out games improve absolute error by at least 5%; otherwise they stay neutral.
          Team scores and player projections are separate estimates. Missing players and statistics are not invented.</p>
        {!!forecast.injuries.length && <ul>{forecast.injuries.map(player => <li key={player.id}>{player.name}: {player.status}{player.excluded ? ' · Excluded' : ' · Conditional on playing'}</li>)}</ul>}
      </details>
    </>}
  </section>;
}
export function NBASimulationResults({ games }: { games: Game[] }) {
  const [report, setReport] = useState<NBAAccuracyReport | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const key = games.map(game => `${game.eventId}:${game.date}:${game.home.id}:${game.away.id}`).sort().join(',');
  useEffect(() => {
    if (!games.length) { setReport(null); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setReport(null); setError('');
    const load = async () => {
      try { const result = await loadNBAAccuracy(games, controller.signal); if (!controller.signal.aborted) { setReport(result); setError(''); } }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'NBA results could not load.'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), 60000);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, revision]);
  const settled = report?.games.filter(row => row.actuals) ?? [];
  const winnerRecord = settled.reduce((record, row) => {
    const projected = row.forecast.home!.score.mean - row.forecast.away!.score.mean, actual = row.actuals!.home.score - row.actuals!.away.score;
    if (projected === 0) record.noWinner++; else if (Math.sign(projected) === Math.sign(actual)) record.wins++; else record.losses++;
    return record;
  }, { wins: 0, losses: 0, noWinner: 0 });
  const generate = async (signal: AbortSignal) => {
    const fresh = await loadNBAAccuracy(games, signal);
    return renderNBASimulationGraphic('NBA Simulation Results', 'Verified finals vs archived pregame forecasts',
      fresh.games.filter(row => row.actuals).flatMap(row => {
        const forecast = row.forecast, actuals = row.actuals!;
        return [{ title: `${forecast.away!.abbr} at ${forecast.home!.abbr}`,
          detail: `Saved ${stamp(forecast.forecastAt!)}`,
          line: `SIM ${value(forecast.away!.score.mean)}-${value(forecast.home!.score.mean)} | FINAL ${actuals.away.score}-${actuals.home.score}`,
          note: 'Verified final scores; expected simulated scores are not an exact-score call.' },
        ...[forecast.away!, forecast.home!].flatMap(team => team.players.flatMap(player => {
          const actual = [actuals.away, actuals.home].find(side => side.id === team.id)?.players[player.id];
          return actual ? [{ title: `${player.name} | ${team.abbr}`, detail: `SIM ${line(player)}`,
            line: `ACTUAL ${actual.points} PTS / ${actual.rebounds} REB / ${actual.assists} AST`,
            note: `PRA: ${value(player.stats.pra.mean)} projected / ${actual.points + actual.rebounds + actual.assists} actual` }] : [];
        }))];
      }));
  };
  return <section className="nba-simulation-panel" aria-label="NBA simulation results"><h3>NBA simulation results</h3>
    <button type="button" onClick={() => setRevision(n => n + 1)}>Refresh results</button>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {!report && !error && <p role="status">Loading verified results...</p>}
    {report && <><p>Winner calls: {winnerRecord.wins} W · {winnerRecord.losses} L · {winnerRecord.noWinner} no winner forecast.
      {' '}{report.games.length - settled.length} pending · {report.issues.length} unavailable.</p>
      {report.issues.map(issue => <p key={issue} className="nba-note">{issue}</p>)}
      {report.games.map(row => <details key={row.eventId}><summary>{row.forecast.away!.abbr} at {row.forecast.home!.abbr}
        {row.actuals ? ` · Final ${row.actuals.away.score}–${row.actuals.home.score}` : ' · Awaiting verified final'}</summary>
        <p>Pregame expected score: {value(row.forecast.away!.score.mean)}–{value(row.forecast.home!.score.mean)} · Saved {stamp(row.forecast.forecastAt!)}</p>
        {[row.forecast.away!, row.forecast.home!].map(team => <div key={team.id} className="nba-table-scroll" role="region" aria-label={`${team.name} PRA results`} tabIndex={0}>
          <table className="nba-table"><thead><tr><th>{team.abbr} player</th><th>Sim PRA</th><th>Actual PRA</th><th>Difference</th></tr></thead>
            <tbody>{team.players.map(player => {
              const actual = row.actuals && [row.actuals.away, row.actuals.home].find(side => side.id === team.id)?.players[player.id];
              const pra = actual ? actual.points + actual.rebounds + actual.assists : null;
              return <tr key={player.id}><th scope="row">{player.name}</th><td>{value(player.stats.pra.mean)}</td>
                <td>{pra === null ? row.actuals ? 'Not verified / DNP' : 'Pending' : pra}</td><td>{pra === null ? '—' : value(Math.abs(pra - player.stats.pra.mean))}</td></tr>;
            })}</tbody></table>
        </div>)}
      </details>)}
    </>}
    <NBAGraphicDownload generate={generate} disabled={!settled.length} filename="GameWire-NBA-Simulation-Results.png"
      label="Download NBA results" description="Refreshed verified finals and archived player projections" alt="NBA simulation results with actual team scores and player PRA" />
  </section>;
}
