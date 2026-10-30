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
function PlayerPortrait({ player }: { player: BotPlayer }) {
  const [failed, setFailed] = useState(false);
  return <div className="gwb-portrait">{failed ? <span>{player.position}<small>Photo unavailable</small></span>
    : <OfflineImage src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`} alt="" onError={() => setFailed(true)} />}</div>;
}
function Breakdown({ report }: { report: BotReport }) {
  const matchup = report.matchup, editorial = report.editorial;
  return <article className="gwb-answer">
    <header><span className="gwb-avatar"><Bot size={18} aria-hidden="true" /></span><div><b>Gamew<span className="gwb-ai">AI</span>re</b><span>PLAYER ANALYSIS · Week {report.week} · {report.season} · {formats.find((row) => row.value === report.format)?.label}</span></div></header>
    <div className="gwb-player-line"><PlayerPortrait key={report.player.id} player={report.player} /><div><h4>{report.player.name}</h4><span>{report.player.position} · {report.player.team}</span>
      <div className="gwb-tags"><span>PLAYER ANALYSIS</span><span>FANTASY</span></div></div></div>
    <div className="gwb-verdict-grid"><div><span>START / SIT</span><strong className={report.indication === 'Must Start' || report.indication === 'Start' ? 'gwb-positive' : ''}>{report.indication}</strong><small>GameWire’s weekly verdict</small></div>
      <div><span>GUIDANCE SOURCES</span><strong>{editorial.graphics.length ? 'Published Start/Sit' : 'Recent workload'}</strong>
        <small>{editorial.ranking ? `GameWire ${formats.find((row) => row.value === editorial.ranking!.format)?.label} · ${editorial.ranking.position} #${editorial.ranking.rank}` : 'No matching weekly ranking supplied yet'}</small></div></div>
    <p className="gwb-muted">Verified snapshot · {stamp(report.checkedAt)} · Not a live injury or odds feed.</p>
    {report.dataIssues.length > 0 && <div className="gwb-warning" role="status"><b>Partial data · Some sources could not load</b>
      {report.dataIssues.map((issue) => <p key={issue}>{issue}</p>)}<p>Only available verified sources are used. Use Refresh outlook to retry; partial snapshots cache for 30 seconds.</p></div>}
    <>
      <p className="gwb-muted">Roster availability: {report.availability}. Check the official game-day injury report.</p>
      <div className="gwb-stat-grid">{[...report.workload, ...report.production].map((stat) => <div key={stat.label}><strong>{stat.average.toFixed(1)}</strong><span>{stat.label}/game</span><small>Last {stat.games} recorded appearances</small></div>)}</div>
      {report.fantasyAverage !== null ? <p className="gwb-muted">Historical scoring average: {report.fantasyAverage.toFixed(1)} points/game. Not a projection.</p>
        : <p className="gwb-muted">A complete fantasy scoring average is unavailable; unreported stats are not treated as zero.</p>}
    </>
    <section><h5>This week’s matchup</h5>
      {matchup ? <p>{report.player.teamAbbr} {matchup.home ? 'vs.' : '@'} {matchup.opponent} · {stamp(matchup.start)} · {matchup.state === 'pre' ? 'Scheduled' : matchup.state === 'in' ? 'In progress' : 'Final'}</p> : <p>No game on the current week scoreboard.</p>}
      {matchup && <p>{report.matchupText}</p>}</section>
    <section className="gwb-prop-lab"><h5>Prop Lab</h5>
      {report.projections.length > 0 && <><p className="gwb-muted">Matchup-adjusted estimates · Not sportsbook lines.</p>
        {report.projections.map((projection) => <div className="gwb-projection" key={projection.market}><div className="gwb-projection-heading"><b>{projection.label}</b>
          <strong>{projection.estimate === null ? 'Unavailable' : <>{projection.estimate}<small>{projection.unit === 'receptions' ? ' catches' : ' yd'} estimate</small></>}</strong></div>
          {projection.limitedData && projection.estimate !== null && <small className="gwb-muted">Limited-data estimate · {projection.playerGames} player / {projection.defenseGames} opponent games</small>}
          {projection.role && <small className="gwb-muted">{projection.role.source === 'depth-chart' ? `ESPN depth chart · ${report.player.position} depth ${projection.role.rank}` : `Recent usage rank ${projection.role.rank} at ${report.player.position} · Not a confirmed depth chart`}</small>}
          {projection.defenseRank != null && <small className="gwb-muted">Opponent {report.player.position} yardage allowance · #{projection.defenseRank} of 32 (1 = fewest)</small>}
          <p>{projection.explanation}</p></div>)}</>}
      {report.props.map((prop) => <div className="gwb-prop" key={prop.selection}><b>{prop.selection}</b><span>{prop.american > 0 ? '+' : ''}{prop.american} · {prop.book} · Saved line {stamp(prop.savedAt)}</span><p>{prop.breakdown}</p></div>)}
      {!report.props.length && !report.projections.length && report.production.map((stat) => <div className="gwb-prop-empty" key={stat.label}><div><b>{stat.label}</b><span>Recent recorded average, not a projection</span></div><div><strong>{stat.average.toFixed(1)}<small> avg</small></strong><span>No published line</span></div></div>)}
      <p className="gwb-muted">{report.propNote}</p></section>
    <section className="gwb-verdict"><h5><Sparkles size={16} aria-hidden="true" />GamewAIre Verdict</h5><p>{report.summary}</p>
      {editorial.graphics.map((graphic) => <div className="gwb-editorial" key={graphic.id}><b>Published Week {report.week} Must {graphic.kind === 'start' ? 'Start' : 'Sit'} graphic</b><p>{graphic.reason}</p><small>Graphic updated {stamp(graphic.updatedAt)}</small></div>)}
      {editorial.ranking && <p className="gwb-muted">This weekly ranking matches your selected scoring format and adds a bounded editorial adjustment to available estimates.</p>}
    </section>
    <details className="gwb-method"><summary>Sources &amp; how this analysis works</summary>
      <p>Data checked {stamp(report.checkedAt)}. Workload snapshots may be cached for five minutes; player search for fifteen minutes. Regular-season appearances only.</p>
      <p>Without published editorial guidance: Start requires QB 25+ pass attempts; RB 15+ touches; WR 7+ targets (8 in standard); TE 5+ targets (6 in standard). Flex: RB 8+ touches, WR 4+ targets, TE 3+ targets. Lower usage indicates Sit; fewer than three appearances, a 21-day data gap or uncertain availability indicates Monitor. Published weekly graphics use their Must Start/Must Sit verdict. A matching top-12 QB/TE or top-24 RB/WR ranking plus Start-level workload also supports Must Start.</p>
      <p>Yardage and reception estimates use verified completed games, including box scores when player logs are incomplete. One or two samples are labeled limited-data with smaller adjustments. ESPN depth-chart order, or clearly labeled recent usage when unavailable, caps backup opportunity without treating usage as a confirmed starting role. Verified bottom-four WR/TE yardage defenses receive an additional bounded matchup boost; scoring-defense rank alone never triggers it. Matching weekly rankings contribute up to +/-5% as editorial context. These are experimental estimates, not calibrated predictions or sportsbook lines. Missing data is never invented.</p>
      <p>Scoring, when complete: 0.04/pass yard, 4/pass TD, -2/interception, 0.1/rush or receiving yard, 6/rush or receiving TD, -2/fumble lost, plus 1/0.5/0 per reception for PPR/half/standard. No bonuses or two-point conversions included.</p>
      {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <nav aria-label={`${report.player.name} data sources`}><a href={`https://www.espn.com/nfl/player/gamelog/_/id/${report.player.id}`} target="_blank" rel="noreferrer">ESPN game logs</a>
        <a href={`https://www.espn.com/nfl/team/roster/_/id/${report.player.teamId}`} target="_blank" rel="noreferrer">ESPN roster</a>
        <a href={`https://www.espn.com/nfl/scoreboard/_/year/${report.season}/seasontype/2/week/${report.week}`} target="_blank" rel="noreferrer">Week scoreboard</a></nav>
    </details>
  </article>;
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
        <div className="gwb-hero-robot" aria-hidden="true"><Bot strokeWidth={1.6} /><Activity className="gwb-robot-pulse" /></div>
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
      {comparing && <div className="gwb-compare-slots" aria-label="Choose comparison player">
        {([0, 1] as const).map((slot) => <button key={slot} disabled={!!busy} aria-pressed={activeSlot === slot} onClick={() => {
          setActiveSlot(slot); setSearch(''); setError(''); searchInput.current?.focus();
        }}><small>Player {slot + 1}</small><b>{(slot === 0 ? selected : secondPlayer)?.name ?? 'Choose a player'}</b><span>{activeSlot === slot ? 'Searching this slot' : 'Change player'}</span></button>)}
      </div>}
      {comparing && <p className="gwb-muted" role="status">Search above to choose Player {activeSlot + 1}. Both outlooks use {formats.find((row) => row.value === format)?.label} scoring.</p>}
      {(selected || comparing && secondPlayer) && <div className="gwb-selected-players" aria-label="Selected players">
        {([selected, comparing ? secondPlayer : null]).map((player, slot) => player && <div key={slot}>
          <span>{comparing ? `Player ${slot + 1}: ` : ''}{player.name}</span>
          <button type="button" disabled={!!busy} aria-label={`Clear ${player.name}`} onClick={() => clearPlayer(slot === 0 ? 0 : 1)}>
            <X size={15} aria-hidden="true" />Clear player
          </button>
        </div>)}
      </div>}
      {directory?.warnings.map((warning) => <p className="gwb-warning" key={warning}>{warning}</p>)}
      {query.length >= 2 && <div id="gwb-player-results" className="gwb-search-results" aria-label="Matching NFL players">
        {matches.map((player) => <button key={player.id} disabled={!!busy} onClick={() => { void analyze(player); }}><span>{player.name}</span><small>{player.teamAbbr} · {player.position}</small><ArrowUp size={15} aria-hidden="true" /></button>)}
        {!matches.length && directory && <p>No matching player in the loaded rosters. Try a surname or refresh search.</p>}</div>}
      {busy && <p className="gwb-loading" role="status"><Sparkles size={16} aria-hidden="true" />{busy === 'directory' ? 'Loading verified NFL rosters. The first search can take a moment...' : 'Checking weekly player outlooks...'}</p>}
      {error && <div className="gwb-error" role="alert"><p>{error}</p><button disabled={!!busy} onClick={() => {
        if (lastAttempt.current === 'report' && lastReports.current.length) void loadOutlooks(lastReports.current.filter(({ slot }) => comparing || slot === 0));
        else void loadPlayers();
      }}>Retry</button></div>}
      {!comparing && !report && !busy && <div className="gwb-welcome"><Bot size={28} aria-hidden="true" /><h4>Your weekly player check-in.</h4><p>Search a QB, RB, WR or TE for Start/Sit guidance, estimates and published props.</p></div>}
      {comparing ? <div className="gwb-comparison" aria-label="Side-by-side player comparison">
        {[report, secondReport].map((outlook, slot) => <section key={slot} aria-label={`Player ${slot + 1} outlook`}>
          {outlook ? <Breakdown report={outlook} /> : <div className="gwb-compare-empty"><Bot size={28} aria-hidden="true" /><h4>Player {slot + 1}</h4>
            <p>{(slot === 0 ? selected : secondPlayer)?.name ?? 'Choose a player using search above.'}</p>{!busy && <button onClick={() => { setActiveSlot(slot === 0 ? 0 : 1); searchInput.current?.focus(); }}>Choose player</button>}</div>}
        </section>)}
      </div> : report && <div className="gwb-result" aria-label="Player analysis"><Breakdown report={report} /></div>}
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
