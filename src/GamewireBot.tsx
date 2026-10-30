import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeftRight, ArrowUp, BarChart3, Bot, BrainCircuit, ChevronDown, RefreshCw, Search, Send, ShieldCheck, Sparkles, Target, X } from 'lucide-react';
import { loadBotDirectory, loadBotReport } from './services/gamewireBot';
import type { BotDirectory, BotFormat, BotPlayer, BotReport } from './services/gamewireBot';
import './gamewire-bot.css';
import OfflineImage from './OfflineImage';

type PlayerSlot = 0 | 1;
type OutlookRequest = { player: BotPlayer; slot: PlayerSlot };
const formats: Array<{ value: BotFormat; label: string }> = [{ value: 'ppr', label: 'PPR' }, { value: 'half', label: 'Half PPR' }, { value: 'standard', label: 'Standard' }];
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function BotMark({ compact = false }: { compact?: boolean }) {
  return <div className={`gwb-hero-robot${compact ? ' gwb-avatar' : ''}`} aria-hidden="true"><Bot strokeWidth={1.6} /><Activity className="gwb-robot-pulse" /></div>;
}
function PlayerPortrait({ player }: { player: BotPlayer }) {
  const [failed, setFailed] = useState(false);
  return <div className="gwb-portrait">{failed ? <span>{player.position}<small>Photo unavailable</small></span>
    : <OfflineImage src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`} alt="" onError={() => setFailed(true)} />}</div>;
}
function Guidance({ report }: { report: BotReport }) {
  const editorial = report.editorial;
  return <div className="gwb-verdict-grid"><div><span>START / SIT</span><strong className={report.indication === 'Must Start' || report.indication === 'Start' ? 'gwb-positive' : ''}>{report.indication}</strong><small>GameWire’s weekly verdict</small></div>
    <div><span>GUIDANCE SOURCES</span><strong>{editorial.graphics.length ? 'Published Start/Sit' : 'Recent workload'}</strong>
      <small>{editorial.ranking ? `GameWire ${formats.find((row) => row.value === editorial.ranking!.format)?.label} · ${editorial.ranking.position} #${editorial.ranking.rank}` : 'No matching weekly ranking supplied yet'}</small></div></div>;
}
function Snapshot({ report }: { report: BotReport }) {
  return <><p className="gwb-muted">Verified snapshot · {stamp(report.checkedAt)} · Not a live injury or odds feed.</p>
    {report.dataIssues.length > 0 && <div className="gwb-warning" role="status"><b>Partial data · Some sources could not load</b>
      {report.dataIssues.map((issue) => <p key={issue}>{issue}</p>)}<p>Only available verified sources are used. Use Refresh outlook to retry; partial snapshots cache for 30 seconds.</p></div>}
    <p className="gwb-muted">Roster availability: {report.availability}. Check the official game-day injury report.</p></>;
}
function Matchup({ report }: { report: BotReport }) {
  const matchup = report.matchup;
  return <section><h5>This week’s matchup</h5>
    {matchup ? <p>{report.player.teamAbbr} {matchup.home ? 'vs.' : '@'} {matchup.opponent} · {stamp(matchup.start)} · {matchup.state === 'pre' ? 'Scheduled' : matchup.state === 'in' ? 'In progress' : 'Final'}</p> : <p>No game on the current week scoreboard.</p>}
    {matchup && <p>{report.matchupText}</p>}</section>;
}
function PropLab({ report }: { report: BotReport }) {
  return <section className="gwb-prop-lab"><h5>Prop Lab</h5>
    {report.projections.length > 0 && <><p className="gwb-muted">Experimental estimates · Current-season data · Not sportsbook lines.</p>
      {report.projections.map((projection) => <div className="gwb-projection" key={projection.market}><div className="gwb-projection-heading"><b>{projection.label}</b>
        <strong>{projection.estimate === null ? 'No verified stats' : <>{projection.estimate}<small>{projection.unit === 'receptions' ? ' catches' : ' yd'} estimate</small></>}</strong></div>
        {projection.basis === 'current-season' && projection.estimate !== null && <small className="gwb-muted">Current-season fallback · {projection.playerGames} recorded games · Available role limits applied</small>}
        {projection.limitedData && projection.estimate !== null && <small className="gwb-muted">Limited-data estimate · {projection.playerGames} player / {projection.defenseGames} opponent games</small>}
        {projection.role && <small className="gwb-muted">{projection.role.source === 'depth-chart' ? `ESPN depth chart · ${report.player.position} depth ${projection.role.rank}` : `Recent usage rank ${projection.role.rank} at ${report.player.position} · Not a confirmed depth chart`}</small>}
        {projection.defenseRank != null && <small className="gwb-muted">Opponent {report.player.position} yardage allowance · #{projection.defenseRank} of 32 (1 = fewest)</small>}
        {projection.evidence && <small className="gwb-muted">Matchup: {projection.evidence.matchup} · Forecast confidence: uncalibrated
          {projection.evidence.usage ? ` · ${projection.evidence.usage.trend} ${projection.evidence.usage.label.toLowerCase()}` : ''}</small>}
        <p>{projection.explanation}</p></div>)}</>}
    {report.props.map((prop) => <div className="gwb-prop" key={prop.selection}><b>{prop.selection}</b><span>{prop.american > 0 ? '+' : ''}{prop.american} · {prop.book} · Saved line {stamp(prop.savedAt)}</span><p>{prop.breakdown}</p>
      {prop.comparison && <p>{prop.comparison.assessment} · Difference {prop.comparison.difference > 0 ? '+' : ''}{prop.comparison.difference}.
        {prop.comparison.games > 0 ? ` Recorded games: ${prop.comparison.over} over / ${prop.comparison.under} under / ${prop.comparison.pushes} pushes (${prop.comparison.games} samples; ${prop.comparison.observedOverRate}% observed over, ${prop.comparison.observedUnderRate}% under).` : ' No verified hit-rate sample.'}
        {' '}Historical counts, not forecast probabilities. Saved line only, not a current market edge.</p>}</div>)}
    {!report.props.length && !report.projections.length && report.production.map((stat) => <div className="gwb-prop-empty" key={stat.label}><div><b>{stat.label}</b><span>Recent recorded average, not a projection</span></div><div><strong>{stat.average.toFixed(1)}<small> avg</small></strong><span>No published line</span></div></div>)}
    <p className="gwb-muted">{report.propNote}</p></section>;
}
function Verdict({ report }: { report: BotReport }) {
  const editorial = report.editorial;
  return <section className="gwb-verdict"><h5><Sparkles size={16} aria-hidden="true" />GamewAIre Verdict</h5><p>{report.summary}</p>
    {editorial.graphics.map((graphic) => <div className="gwb-editorial" key={graphic.id}><b>Published Week {report.week} Must {graphic.kind === 'start' ? 'Start' : 'Sit'} graphic</b><p>{graphic.reason}</p><small>Graphic updated {stamp(graphic.updatedAt)}</small></div>)}
    {editorial.ranking && <p className="gwb-muted">This weekly ranking matches your selected scoring format and adds a bounded editorial adjustment to available estimates.</p>}
  </section>;
}
function Breakdown({ report, onClear, busy }: { report: BotReport; onClear: () => void; busy: boolean }) {
  return <article className="gwb-answer">
    <button className="gwb-clear-player" type="button" disabled={busy} aria-label={`Clear ${report.player.name}`} title="Clear player" onClick={onClear}><X size={18} aria-hidden="true" /></button>
    <header><BotMark compact /><div><b>Gamew<span className="gwb-ai">AI</span>re</b><span>PLAYER ANALYSIS · Week {report.week} · {report.season} · {formats.find((row) => row.value === report.format)?.label}</span></div></header>
    <div className="gwb-player-line"><PlayerPortrait key={report.player.id} player={report.player} /><div><h4>{report.player.name}</h4><span>{report.player.position} · {report.player.team}</span>
      <div className="gwb-tags"><span>PLAYER ANALYSIS</span><span>FANTASY</span></div></div></div>
    <Guidance report={report} />
    <Snapshot report={report} />
    <>
      <div className="gwb-stat-grid">{[...report.workload, ...report.production].map((stat) => <div key={stat.label}><strong>{stat.average.toFixed(1)}</strong><span>{stat.label}/game</span><small>Last {stat.games} recorded appearances</small></div>)}</div>
      {report.fantasyAverage !== null ? <p className="gwb-muted">Historical scoring average: {report.fantasyAverage.toFixed(1)} points/game. Not a projection.</p>
        : <p className="gwb-muted">A complete fantasy scoring average is unavailable; unreported stats are not treated as zero.</p>}
    </>
    <Matchup report={report} />
    <PropLab report={report} />
    <Verdict report={report} />
    <Method report={report} />
  </article>;
}
function Method({ report }: { report: BotReport }) {
  return <details className="gwb-method"><summary>Sources &amp; how this analysis works</summary>
      <p>Data checked {stamp(report.checkedAt)}. Workload snapshots may be cached for five minutes; player search for fifteen minutes. Regular-season appearances only.</p>
      <p>Without published editorial guidance: Start requires QB 25+ pass attempts; RB 15+ touches; WR 7+ targets (8 in standard); TE 5+ targets (6 in standard). Flex: RB 8+ touches, WR 4+ targets, TE 3+ targets. Lower usage indicates Sit; fewer than three appearances, a 21-day data gap or uncertain availability indicates Monitor. Published weekly graphics use their Must Start/Must Sit verdict. A matching top-12 QB/TE or top-24 RB/WR ranking plus Start-level workload also supports Must Start.</p>
      <p>Yardage and reception estimates use current-season completed games only, including individual box-score stats when player logs or position-group samples are incomplete. If recent matchup data cannot be verified, a labeled current-season completed-game average with available role limits supplies the estimate. Up to 18 completed games per team are checked for season context. Prior seasons are not used. One or two samples and older workload are labeled limited-data. ESPN depth-chart order, or clearly labeled recent usage when unavailable, caps backup opportunity without treating usage as a confirmed starting role. Verified bottom-four WR/TE yardage defenses can support a wider upside cap only with at least six measured opportunity samples and no material recent volume decline. The rank itself adds no multiplier; scoring-defense rank never triggers it. Matching weekly rankings contribute up to +/-5% as separately identified editorial context. No verified current-season production means no supportable numeric estimate. These are experimental estimates, not calibrated predictions or sportsbook lines. Missing data is never invented.</p>
      <p>The existing estimate is preserved as the foundation. The evidence layer blends 60% available season / 40% recent positional allowance, replacing rather than repeating the existing allowance contribution. Comparable-defense residuals require at least three same-team, similar-volume games with verified pre-kickoff defensive samples, are shrunk and capped at +/-5%, and exclude direct-opponent/contender samples already used. Usage trends are descriptive, not an extra multiplier. Yardage defensive rank never boosts reception counts. No current odds feed or calibrated probability model is connected.</p>
      {report.projections.filter((projection) => projection.evidence).map((projection) => {
        const evidence = projection.evidence!;
        return <section key={projection.market}><h5>{projection.label} evidence</h5>
          <p>Foundation: {evidence.foundation ?? 'No verified stats'} · Independent model: {evidence.independent ?? 'No verified stats'} · Final: {projection.estimate ?? 'No verified stats'}.
            {' '}Editorial adjustment: {evidence.editorialAdjustment > 0 ? '+' : ''}{evidence.editorialAdjustment}. Matchup: {evidence.matchup}.</p>
          {evidence.defense && <p>Opponent positional allowance: recent {evidence.defense.recent} / available season {evidence.defense.season} ({evidence.defense.games} verified games). Position-group totals, not individual projections.
            {evidence.defense.opportunityAverage !== null ? ` Allowed opportunities/game: ${evidence.defense.opportunityAverage} (${evidence.defense.opportunityGames} paired samples).` : ''}
            {evidence.defense.efficiency !== null ? ` Recorded ${projection.unit} allowed/opportunity: ${evidence.defense.efficiency}.` : ''}</p>}
          {evidence.usage && <p>{evidence.usage.label}: recent {evidence.usage.recent} ({evidence.usage.recentGames} games) / available season {evidence.usage.season} per game ({evidence.usage.games} samples). {evidence.usage.trend}.
            {evidence.usage.efficiency !== null ? ` Recorded ${projection.unit} per opportunity: ${evidence.usage.efficiency}.` : ''}</p>}
          <p>Comparable defenses: {evidence.comparable.games} qualifying games; mean {evidence.comparable.mean ?? 'not available'}, median {evidence.comparable.median ?? 'not available'},
            {' '}weighted production {evidence.comparable.weighted ?? 'not applied'}, residual adjustment {evidence.comparable.adjustment}%. {evidence.comparable.note}</p>
          {evidence.observed && <p>Observed production: mean {evidence.observed.mean}, median {evidence.observed.median}, middle 50% {evidence.observed.low}–{evidence.observed.high} ({evidence.observed.games} games).
            {' '}This describes completed games, not a forecast range.</p>}
          <p>{evidence.edge}</p><p>Confidence: {evidence.confidence}. No calibrated over/under percentages are claimed.</p>
          {evidence.risks.map((risk) => <p key={risk}>{risk}</p>)}
          {projection.warnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
          {projection.warnings.length > 3 && <p>{projection.warnings.length - 3} additional source/sample exclusions were recorded. Available verified samples only are used.</p>}
        </section>;
      })}
      <p>Scoring, when complete: 0.04/pass yard, 4/pass TD, -2/interception, 0.1/rush or receiving yard, 6/rush or receiving TD, -2/fumble lost, plus 1/0.5/0 per reception for PPR/half/standard. No bonuses or two-point conversions included.</p>
      {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <nav aria-label={`${report.player.name} data sources`}><a href={`https://www.espn.com/nfl/player/gamelog/_/id/${report.player.id}`} target="_blank" rel="noreferrer">ESPN game logs</a>
        <a href={`https://www.espn.com/nfl/team/roster/_/id/${report.player.teamId}`} target="_blank" rel="noreferrer">ESPN roster</a>
        <a href={`https://www.espn.com/nfl/scoreboard/_/year/${report.season}/seasontype/2/week/${report.week}`} target="_blank" rel="noreferrer">Week scoreboard</a></nav>
    </details>;
}
const comparisonTabs = [
  ['overview', 'Overview'], ['stats', 'Stats'], ['props', 'Props'], ['matchup', 'Matchup'], ['sources', 'Sources'],
] as const;
type ComparisonTab = typeof comparisonTabs[number][0];
type ComparisonValue = { value: number | null; note: string };
type ComparisonRow = { key: string; label: string; values: [ComparisonValue, ComparisonValue]; decimals?: number };
function ComparisonTable({ rows, players, caption }: { rows: ComparisonRow[]; players: [BotPlayer | null, BotPlayer | null]; caption: string }) {
  return <table className="gwb-comparison-table"><caption className="gwb-sr-only">{caption}. Bars compare values, not player quality.</caption>
    <thead><tr><th scope="col">{players[0]?.name ?? 'Player 1'}</th><th scope="col">Metric</th><th scope="col">{players[1]?.name ?? 'Player 2'}</th></tr></thead>
    <tbody>{rows.map((row) => {
      const max = Math.max(...row.values.map((cell) => Math.abs(cell.value ?? 0)));
      const cell = (slot: PlayerSlot) => {
        const { value, note } = row.values[slot];
        return <td><strong>{value === null ? '\u2014' : value.toFixed(row.decimals ?? 1)}</strong>
          {value !== null && max > 0 && <span className="gwb-comparison-bar" aria-hidden="true"><i style={{ width: `${Math.abs(value) / max * 100}%` }} /></span>}
          <small>{note}</small></td>;
      };
      return <tr key={row.key}>{cell(0)}<th scope="row">{row.label}</th>{cell(1)}</tr>;
    })}</tbody>
  </table>;
}
function MobileComparison({ reports, players, onClear, busy }: { reports: [BotReport | null, BotReport | null]; players: [BotPlayer | null, BotPlayer | null]; onClear: (slot: PlayerSlot) => void; busy: boolean }) {
  const [tab, setTab] = useState<ComparisonTab>('overview');
  const stats = reports.map((report) => report ? [...report.workload, ...report.production] : []);
  const labels = [...new Set(stats.flatMap((rows) => rows.map((row) => row.label)))];
  const statRows: ComparisonRow[] = labels.map((label) => {
    const value = (slot: PlayerSlot): ComparisonValue => {
      const stat = stats[slot].find((row) => row.label === label);
      return { value: stat?.average ?? null, note: stat ? `${stat.games} recorded games` : reports[slot] ? 'Not reported' : 'No report' };
    };
    return { key: label, label: `${label} / game`, values: [value(0), value(1)] };
  });
  const fantasy = (slot: PlayerSlot): ComparisonValue => ({ value: reports[slot]?.fantasyAverage ?? null, note: reports[slot]?.fantasyAverage != null ? 'Historical, not projected' : reports[slot] ? 'Incomplete scoring data' : 'No report' });
  statRows.push({ key: 'fantasy', label: 'Fantasy points / game', values: [fantasy(0), fantasy(1)] });
  const markets = [...new Map(reports.flatMap((report) => report?.projections ?? []).map((projection) => [projection.market, projection])).values()];
  const estimateRows: ComparisonRow[] = markets.map((metric) => {
    const value = (slot: PlayerSlot): ComparisonValue => {
      const projection = reports[slot]?.projections.find((row) => row.market === metric.market);
      return { value: projection?.estimate ?? null, note: projection?.estimate != null ? projection.basis === 'current-season' ? 'Current-season fallback' : projection.limitedData ? 'Limited-data estimate' : 'Estimate' : projection ? 'No verified stats' : reports[slot] ? 'Not applicable to player' : 'No report' };
    };
    return { key: metric.market, label: `${metric.label} (${metric.unit === 'yards' ? 'yd' : 'catches'})`, values: [value(0), value(1)], decimals: metric.unit === 'yards' ? 0 : 1 };
  });
  const playerContent = (render: (report: BotReport) => React.ReactNode) => <div className="gwb-compare-pair">{reports.map((report, slot) =>
    <article key={slot} className="gwb-compare-detail" aria-label={`${players[slot]?.name ?? `Player ${slot + 1}`} ${tab}`}>
      {players[slot] && <button className="gwb-clear-player" type="button" disabled={busy} aria-label={`Clear ${players[slot]!.name}`} title="Clear player" onClick={() => onClear(slot === 0 ? 0 : 1)}><X size={18} aria-hidden="true" /></button>}
      <h5>{players[slot]?.name ?? `Player ${slot + 1}`}</h5>
      {report ? render(report) : <p className="gwb-muted">Choose a player above. If their report could not load, use Retry.</p>}
    </article>)}</div>;
  return <div className="gwb-mobile-comparison" aria-label="Mobile player comparison">
    <div className="gwb-comparison-tabs" role="tablist" aria-label="Player comparison sections" onKeyDown={(event) => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const current = buttons.findIndex((button) => button === event.target);
      if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); buttons[next].click();
    }}>
      {comparisonTabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`gwb-compare-${key}-tab`}
        aria-selected={tab === key} aria-controls="gwb-compare-content-panel" tabIndex={tab === key ? 0 : -1}
        onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {reports.some((report) => report?.dataIssues.length) && <p className="gwb-warning" role="status">Partial data: {reports.flatMap((report) => report?.dataIssues.length ? [report.player.name] : []).join(' / ')}. See Overview or Sources for unavailable feeds.</p>}
    <div className="gwb-comparison-content" role="tabpanel" id="gwb-compare-content-panel" aria-labelledby={`gwb-compare-${tab}-tab`} tabIndex={0}>
      {tab === 'overview' && <>
        <h4><BarChart3 size={17} aria-hidden="true" />Recent recorded averages</h4>
        <p className="gwb-muted">Recorded appearances, not season averages. Each player’s sample size is shown; missing stats are not zero.</p>
        <ComparisonTable rows={statRows} players={players} caption="Recorded averages by player" />
        <h4><Sparkles size={17} aria-hidden="true" />Quick take</h4>
        {playerContent((report) => <><p className="gwb-muted">Week {report.week} · {report.season} · {formats.find((row) => row.value === report.format)?.label}</p>
          <Verdict report={report} />
          <details className="gwb-compare-guidance"><summary>Weekly guidance &amp; availability</summary><Guidance report={report} /><Snapshot report={report} /></details></>)}
      </>}
      {tab === 'stats' && <><h4><BarChart3 size={17} aria-hidden="true" />Recent recorded averages</h4>
        <p className="gwb-muted">Per-game averages from each player’s available recorded appearances. Sample sizes may differ. Bars compare values, not player quality. Unreported stats are not zero.</p>
        <ComparisonTable rows={statRows} players={players} caption="Recorded averages by player" /></>}
      {tab === 'props' && <><h4><Target size={17} aria-hidden="true" />Prop Lab estimates</h4>
        <p className="gwb-muted">Experimental estimates · Not sportsbook lines. Different positions may have different available metrics.</p>
        {estimateRows.length ? <ComparisonTable rows={estimateRows} players={players} caption="Current-season estimates by player" /> : <p>No verified estimates available. Published prop coverage is shown below.</p>}
        {playerContent((report) => <PropLab report={report} />)}
      </>}
      {tab === 'matchup' && <><h4><ArrowLeftRight size={17} aria-hidden="true" />This week’s matchups</h4>{playerContent((report) => <Matchup report={report} />)}</>}
      {tab === 'sources' && <><h4><ShieldCheck size={17} aria-hidden="true" />Sources &amp; availability</h4>{playerContent((report) => <><Snapshot report={report} /><Method report={report} /></>)}</>}
    </div>
  </div>;
}
export default function GamewireBot() {
  const [open, setOpen] = useState(false), [directory, setDirectory] = useState<BotDirectory | null>(null);
  const [search, setSearch] = useState(''), [format, setFormat] = useState<BotFormat>('ppr'), [selected, setSelected] = useState<BotPlayer | null>(null);
  const [report, setReport] = useState<BotReport | null>(null);
  const [busy, setBusy] = useState<'directory' | 'report' | null>(null), [error, setError] = useState('');
  const [comparing, setComparing] = useState(false), [activeSlot, setActiveSlot] = useState<PlayerSlot>(0);
  const [secondPlayer, setSecondPlayer] = useState<BotPlayer | null>(null), [secondReport, setSecondReport] = useState<BotReport | null>(null);
  const controller = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const lastAttempt = useRef<'directory' | 'report'>('directory');
  const lastReports = useRef<OutlookRequest[]>([]);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  async function loadPlayers() {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    const timer = window.setTimeout(() => next.abort(), 70_000); lastAttempt.current = 'directory'; setBusy('directory'); setError('');
    try { const data = await loadBotDirectory(next.signal); if (!next.signal.aborted) setDirectory(data); }
    catch (cause) { if (controller.current === next) setError(next.signal.aborted ? 'Player search timed out. Retry loading the NFL directory.' : cause instanceof Error ? cause.message : 'Player search failed. Retry.'); }
    finally { window.clearTimeout(timer); if (controller.current === next) setBusy(null); }
  }
  async function loadOutlooks(requests: OutlookRequest[], nextFormat = format) {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    const timer = window.setTimeout(() => next.abort(), 70_000); lastAttempt.current = 'report'; lastReports.current = requests;
    setBusy('report'); setError(''); setSearch('');
    for (const { player, slot } of requests) {
      if (slot === 0) { setSelected(player); setReport(null); }
      else { setSecondPlayer(player); setSecondReport(null); }
    }
    try {
      const results = await Promise.allSettled(requests.map(async ({ player }) => {
        const data = await loadBotReport(player.id, nextFormat, next.signal);
        if (next.signal.aborted) throw new Error('Player breakdown timed out. Retry.');
        return data;
      }));
      if (controller.current !== next) return;
      const failures: string[] = [];
      results.forEach((result, index) => {
        const { player, slot } = requests[index];
        if (result.status === 'rejected') {
          failures.push(`${player.name}: ${next.signal.aborted ? 'Player breakdown timed out. Retry.' : result.reason instanceof Error ? result.reason.message : 'The breakdown could not load. Retry.'}`);
        } else if (slot === 0) setReport(result.value);
        else setSecondReport(result.value);
      });
      setError(failures.join(' '));
    }
    finally { window.clearTimeout(timer); if (controller.current === next) setBusy(null); }
  }
  function analyze(player: BotPlayer, nextFormat = format, slot = activeSlot) {
    if (comparing && player.id === (slot === 0 ? secondPlayer : selected)?.id) {
      setError('Choose two different players to compare.'); return;
    }
    return loadOutlooks([{ player, slot }], nextFormat);
  }
  function clearPlayer(slot: PlayerSlot) {
    if (busy) return;
    if (slot === 0) { setSelected(null); setReport(null); }
    else { setSecondPlayer(null); setSecondReport(null); }
    lastReports.current = lastReports.current.filter((request) => request.slot !== slot);
    setActiveSlot(slot); setSearch(''); setError('');
    searchInput.current?.focus();
  }
  const query = search.trim().toLocaleLowerCase();
  const matches = query.length >= 2 ? directory?.players.filter((player) => `${player.name} ${player.teamAbbr}`.toLocaleLowerCase().includes(query)
    && (!comparing || player.id !== (activeSlot === 0 ? secondPlayer : selected)?.id)).slice(0, 10) ?? [] : [];
  function openBot() {
    setOpen(true);
    if (!directory && !busy) void loadPlayers();
  }
  return <section className="gwb" aria-label="GamewAIre player analysis">
    <header className="gwb-hero">
      <div className="gwb-hero-main">
        <BotMark />
        <div className="gwb-hero-copy">
          <div className="gwb-wordmark">Gamew<strong>AI</strong>re<Activity aria-hidden="true" /></div>
          <span className="gwb-hero-kicker">NFL PLAYER ANALYSIS</span>
          <div className="gwb-hero-title"><h3>Your Gamew<strong>AI</strong>re Player Lab.</h3><span className="gwb-preview-badge"><span />PLAYER LAB</span></div>
          <p>One player. Real data. Smarter insights.</p>
        </div>
        <button className="gwb-toggle" aria-expanded={open} aria-controls="gamewire-bot-panel" onClick={() => { if (open) setOpen(false); else openBot(); }}>
          {open ? 'Close' : 'Open Lab'}{open ? <X size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
        <svg className="gwb-hero-pulse" viewBox="0 0 400 130" fill="none" aria-hidden="true"><path d="M0 70H210L222 94L246 10L268 122L286 56L300 70H400" /></svg>
      </div>
      <div className="gwb-hero-footer">
        <div className="gwb-hero-features" aria-label="Bot features">
          <div><BarChart3 aria-hidden="true" /><span><b>Real Data</b><small>Stats, trends &amp; matchups</small></span></div>
          <div><BrainCircuit aria-hidden="true" /><span><b>Matchup Analysis</b><small>Verified weekly context</small></span></div>
          <div><Target aria-hidden="true" /><span><b>Player Focused</b><small>A clearer outlook</small></span></div>
        </div>
        <form className="gwb-hero-search" onSubmit={(event) => {
          event.preventDefault(); openBot();
          if (matches.length === 1 && !busy) void analyze(matches[0]);
          else searchInput.current?.focus();
        }}>
          <Search size={22} aria-hidden="true" /><label className="gwb-sr-only" htmlFor="gwb-player-search">Find an NFL player</label>
          <input id="gwb-player-search" ref={searchInput} value={search} disabled={busy === 'report'} maxLength={80}
            placeholder="Search a player for start/sit, props or matchups..." aria-controls={open && query.length >= 2 ? 'gwb-player-results' : undefined}
            onFocus={openBot} onChange={(event) => { setSearch(event.target.value); openBot(); }} />
          {search && <button type="button" disabled={busy === 'report'} aria-label="Clear player search" onClick={() => {
            setSearch(''); searchInput.current?.focus();
          }}><X size={18} aria-hidden="true" /></button>}
          <button type="submit" disabled={!!busy} aria-label="Search NFL players"><Send size={23} aria-hidden="true" /></button>
        </form>
      </div>
    </header>
    {open && <div id="gamewire-bot-panel" className="gwb-panel">
      <div className="gwb-mode"><ShieldCheck size={16} aria-hidden="true" /><span>Verified NFL data · Search-only player analysis · Experimental estimates</span></div>
      <div className="gwb-controls"><label>League scoring<select value={format} disabled={!!busy} onChange={(event) => {
        const nextFormat = formats.find((row) => row.value === event.target.value)?.value;
        if (nextFormat) {
          setFormat(nextFormat);
          const requests: OutlookRequest[] = [];
          if (selected) requests.push({ player: selected, slot: 0 });
          if (comparing && secondPlayer) requests.push({ player: secondPlayer, slot: 1 });
          if (requests.length) void loadOutlooks(requests, nextFormat);
        }
      }}>{formats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <button className="gwb-icon-button" disabled={!!busy} onClick={() => { void loadPlayers(); }} aria-label="Refresh NFL player search"><RefreshCw size={17} aria-hidden="true" /></button>
        <button className="gwb-compare-button" disabled={!!busy} aria-pressed={comparing} onClick={() => {
          setComparing(!comparing); setSearch(''); setError('');
          if (comparing) { setActiveSlot(0); setSecondPlayer(null); setSecondReport(null); }
          else { setActiveSlot(selected ? 1 : 0); searchInput.current?.focus(); }
        }}><ArrowLeftRight size={17} aria-hidden="true" />{comparing ? 'Exit Compare' : 'Compare'}</button></div>
      {comparing && <div className="gwb-compare-heading"><h4>Compare Players</h4><p>Side-by-side outlooks, stats, estimates and matchups.</p></div>}
      {comparing && <div className="gwb-compare-slots" aria-label="Choose comparison player">
        {([0, 1] as const).map((slot) => {
          const player = slot === 0 ? selected : secondPlayer;
          return <button key={slot} disabled={!!busy} aria-pressed={activeSlot === slot} onClick={() => {
          setActiveSlot(slot); setSearch(''); setError(''); searchInput.current?.focus();
        }}><small>Player {slot + 1}</small>
          {player && <PlayerPortrait key={player.id} player={player} />}
          <b>{player?.name ?? 'Choose a player'}</b>
          {player && <small>{player.position} · {player.teamAbbr}</small>}
          {(slot === 0 ? report : secondReport) && <small className="gwb-slot-verdict">{(slot === 0 ? report : secondReport)?.indication}</small>}
          <span>{activeSlot === slot ? 'Searching this slot' : 'Change player'}</span></button>;
        })}
      </div>}
      {comparing && <p className="gwb-muted" role="status">Search above for Player {activeSlot + 1} · {formats.find((row) => row.value === format)?.label} scoring.</p>}
      {directory?.warnings.map((warning) => <p className="gwb-warning" key={warning}>{warning}</p>)}
      {query.length >= 2 && <div id="gwb-player-results" className="gwb-search-results" aria-label="Matching NFL players">
        {matches.map((player) => <button key={player.id} disabled={!!busy} onClick={() => { void analyze(player); }}><span>{player.name}</span><small>{player.teamAbbr} · {player.position}</small><ArrowUp size={15} aria-hidden="true" /></button>)}
        {!matches.length && directory && <p>No matching player in the loaded rosters. Try a surname or refresh search.</p>}</div>}
      {busy && <p className="gwb-loading" role="status"><Sparkles size={16} aria-hidden="true" />{busy === 'directory' ? 'Loading verified NFL rosters. The first search can take a moment...' : 'Checking weekly player outlooks...'}</p>}
      {error && <div className="gwb-error" role="alert"><p>{error}</p><button disabled={!!busy} onClick={() => {
        if (lastAttempt.current === 'report' && lastReports.current.length) void loadOutlooks(lastReports.current.filter(({ slot }) => comparing || slot === 0));
        else void loadPlayers();
      }}>Retry</button></div>}
      {!comparing && !report && !busy && <div className="gwb-welcome">
        {selected && <button className="gwb-clear-player" type="button" aria-label={`Clear ${selected.name}`} title="Clear player" onClick={() => clearPlayer(0)}><X size={18} aria-hidden="true" /></button>}
        <Bot size={28} aria-hidden="true" /><h4>Your weekly player check-in.</h4><p>Search a QB, RB, WR or TE for Start/Sit guidance, estimates and published props.</p></div>}
      {comparing && <MobileComparison reports={[report, secondReport]} players={[selected, secondPlayer]} onClear={clearPlayer} busy={!!busy} />}
      {comparing ? <div className="gwb-comparison" aria-label="Side-by-side player comparison">
        {[report, secondReport].map((outlook, slot) => <section key={slot} aria-label={`Player ${slot + 1} outlook`}>
          {outlook ? <Breakdown report={outlook} onClear={() => clearPlayer(slot === 0 ? 0 : 1)} busy={!!busy} /> : <div className="gwb-compare-empty">
            {(slot === 0 ? selected : secondPlayer) && <button className="gwb-clear-player" type="button" disabled={!!busy} aria-label={`Clear ${(slot === 0 ? selected : secondPlayer)!.name}`} title="Clear player" onClick={() => clearPlayer(slot === 0 ? 0 : 1)}><X size={18} aria-hidden="true" /></button>}
            <Bot size={28} aria-hidden="true" /><h4>Player {slot + 1}</h4>
            <p>{(slot === 0 ? selected : secondPlayer)?.name ?? 'Choose a player using search above.'}</p>{!busy && <button onClick={() => { setActiveSlot(slot === 0 ? 0 : 1); searchInput.current?.focus(); }}>Choose player</button>}</div>}
        </section>)}
      </div> : report && <div className="gwb-result" aria-label="Player analysis"><Breakdown report={report} onClear={() => clearPlayer(0)} busy={!!busy} /></div>}
      {comparing && (selected || secondPlayer) && <button className="gwb-compare-refresh" disabled={!!busy} onClick={() => {
        const requests: OutlookRequest[] = [];
        if (selected) requests.push({ player: selected, slot: 0 });
        if (secondPlayer) requests.push({ player: secondPlayer, slot: 1 });
        void loadOutlooks(requests);
      }}>Refresh comparison</button>}
      {!comparing && report && <button className="gwb-compare-refresh" disabled={!!busy} onClick={() => { void analyze(report.player); }}>Refresh outlook</button>}
    </div>}
  </section>;
}
