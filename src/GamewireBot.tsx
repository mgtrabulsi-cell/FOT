import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { botTopic, loadBotDirectory, loadBotReport } from './services/gamewireBot';
import type { BotDirectory, BotFormat, BotPlayer, BotReport, BotTopic } from './services/gamewireBot';
import './gamewire-bot.css';
import OfflineImage from './OfflineImage';

type Message = { id: number; question: string; report?: BotReport; topic: BotTopic; unsupported?: boolean };
const formats: Array<{ value: BotFormat; label: string }> = [{ value: 'ppr', label: 'PPR' }, { value: 'half', label: 'Half PPR' }, { value: 'standard', label: 'Standard' }];
const topics: Array<{ value: BotTopic; label: string }> = [{ value: 'overview', label: 'Weekly outlook' }, { value: 'start-sit', label: 'Start or sit?' }, { value: 'props', label: 'Prop outlook' }, { value: 'matchup', label: 'The matchup' }];
const stamp = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function PlayerPortrait({ player }: { player: BotPlayer }) {
  const [failed, setFailed] = useState(false);
  return <div className="gwb-portrait">{failed ? <span>{player.position}<small>Photo unavailable</small></span>
    : <OfflineImage src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`} alt="" onError={() => setFailed(true)} />}</div>;
}
function Breakdown({ report, topic }: { report: BotReport; topic: BotTopic }) {
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
    {(topic === 'overview' || topic === 'start-sit') && <>
      <p className="gwb-muted">Roster availability: {report.availability}. Check the official game-day injury report.</p>
      <div className="gwb-stat-grid">{[...report.workload, ...report.production].map((stat) => <div key={stat.label}><strong>{stat.average.toFixed(1)}</strong><span>{stat.label}/game</span><small>Last {stat.games} recorded appearances</small></div>)}</div>
      {report.fantasyAverage !== null ? <p className="gwb-muted">Historical scoring average: {report.fantasyAverage.toFixed(1)} points/game. Not a projection.</p>
        : <p className="gwb-muted">A complete fantasy scoring average is unavailable; unreported stats are not treated as zero.</p>}
    </>}
    {(topic === 'overview' || topic === 'matchup') && <section><h5>This week’s matchup</h5>
      {matchup ? <p>{report.player.teamAbbr} {matchup.home ? 'vs.' : '@'} {matchup.opponent} · {stamp(matchup.start)} · {matchup.state === 'pre' ? 'Scheduled' : matchup.state === 'in' ? 'In progress' : 'Final'}</p> : <p>No game on the current week scoreboard.</p>}
      {matchup && <p>{report.matchupText}</p>}</section>}
    {(topic === 'overview' || topic === 'props') && <section className="gwb-prop-lab"><h5>Prop Lab</h5>
      {report.projections.length > 0 && <><p className="gwb-muted">Experimental matchup-adjusted yardage estimates · Not sportsbook lines or the published-pick model.</p>
        {report.projections.map((projection) => <div className="gwb-projection" key={projection.market}><div className="gwb-projection-heading"><b>{projection.label}</b>
          <strong>{projection.yards === null ? 'Unavailable' : <>{projection.yards}<small> yd estimate</small></>}</strong></div>
          <p>{projection.explanation}</p><div className="gwb-projection-evidence">
            <span>Player baseline: {projection.baseline ?? 'Unavailable'} yd · {projection.playerGames} games</span>
            <span>{report.player.position} position-group allowance: {projection.defenseAverage ?? 'Unavailable'} yd/game · {projection.defenseGames} games</span>
            <span>Measured position-yard share: {projection.share === null ? 'Unavailable' : `${projection.share}%`}</span>
            <span>Vs. this opponent: {projection.historyAverage === null ? 'Insufficient sample' : `${projection.historyAverage} yd/game`} · {projection.historyGames} meetings</span>
            <span>Verified contender-game split: {projection.contenderAverage === null ? 'Insufficient sample' : `${projection.contenderAverage} yd/game`} · {projection.contenderGames} games</span>
          </div><p className="gwb-muted">{projection.context}</p>
          <details className="gwb-method"><summary>Verified sample games · {projection.sourceGames.length}{projection.warnings.length ? ` · Limited coverage: ${projection.warnings.length} notes` : ''}</summary>
            <nav aria-label={`${projection.label} sample box scores`}>{projection.sourceGames.map((game) => <a key={`${game.role}:${game.id}`} href={`https://www.espn.com/nfl/boxscore/_/gameId/${game.id}`} target="_blank" rel="noreferrer">{game.role === 'team' ? report.player.teamAbbr : 'Opponent allowed'} · {stamp(game.date)}</a>)}</nav>
            {projection.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details></div>)}</>}
      {report.props.map((prop) => <div className="gwb-prop" key={prop.selection}><b>{prop.selection}</b><span>{prop.american > 0 ? '+' : ''}{prop.american} · {prop.book} · Saved line {stamp(prop.savedAt)}</span><p>{prop.breakdown}</p></div>)}
      {!report.props.length && !report.projections.length && report.production.map((stat) => <div className="gwb-prop-empty" key={stat.label}><div><b>{stat.label}</b><span>Recent recorded average, not a projection</span></div><div><strong>{stat.average.toFixed(1)}<small> avg</small></strong><span>No published line</span></div></div>)}
      <p className="gwb-muted">{report.propNote}</p></section>}
    <section className="gwb-verdict"><h5><Sparkles size={16} aria-hidden="true" />GamewAIre Verdict</h5><p>{report.summary}</p>
      {editorial.graphics.map((graphic) => <div className="gwb-editorial" key={graphic.id}><b>Published Week {report.week} Must {graphic.kind === 'start' ? 'Start' : 'Sit'} graphic</b><p>{graphic.reason}</p><small>Graphic updated {stamp(graphic.updatedAt)}</small></div>)}
      {editorial.ranking && <p className="gwb-muted">Published PPR rankings are used only for PPR outlooks; other scoring formats require their own list.</p>}
    </section>
    <details className="gwb-method"><summary>Sources &amp; how this preview works</summary>
      <p>Data checked {stamp(report.checkedAt)}. Workload snapshots may be cached for five minutes; player search for fifteen minutes. Regular-season appearances only.</p>
      <p>Without published editorial guidance: Start requires QB 25+ pass attempts; RB 15+ touches; WR 7+ targets (8 in standard); TE 5+ targets (6 in standard). Flex: RB 8+ touches, WR 4+ targets, TE 3+ targets. Lower usage indicates Sit; fewer than three appearances, a 21-day data gap or uncertain availability indicates Monitor. Published weekly graphics use their Must Start/Must Sit verdict. A matching top-12 QB/TE or top-24 RB/WR ranking plus Start-level workload also supports Must Start.</p>
      <p>Experimental yardage model: player baseline is 65% recent-three average / 35% season average; blend 70% baseline with 30% opponent position-group allowance times measured team-position-yard share. Two or more direct meetings add a 10% historical component; three or more verified contender games add 5% when both current teams are top-two in their divisions. Adjustments cap at ±25% of baseline. These weights are transparent heuristics, not fitted or backtested probabilities. Current rosters classify positions when a box score omits them; unclassified nonzero yards exclude that sample. No line-anchoring or automatic big-game boost.</p>
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
  const [report, setReport] = useState<BotReport | null>(null), [messages, setMessages] = useState<Message[]>([]), [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'directory' | 'report' | null>(null), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), messageId = useRef(0), lastMessage = useRef<HTMLDivElement>(null);
  const lastAttempt = useRef<'directory' | 'report'>('directory');
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => { if (messages.length) lastMessage.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [messages.length]);
  async function loadPlayers() {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    const timer = window.setTimeout(() => next.abort(), 70_000); lastAttempt.current = 'directory'; setBusy('directory'); setError('');
    try { const data = await loadBotDirectory(next.signal); if (!next.signal.aborted) setDirectory(data); }
    catch (cause) { if (controller.current === next) setError(next.signal.aborted ? 'Player search timed out. Retry loading the NFL directory.' : cause instanceof Error ? cause.message : 'Player search failed. Retry.'); }
    finally { window.clearTimeout(timer); if (controller.current === next) setBusy(null); }
  }
  async function analyze(player: BotPlayer, nextFormat = format) {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    const timer = window.setTimeout(() => next.abort(), 70_000); lastAttempt.current = 'report'; setBusy('report'); setError(''); setSelected(player); setReport(null);
    try {
      const data = await loadBotReport(player.id, nextFormat, next.signal);
      if (!next.signal.aborted) { setReport(data); setSearch(''); setMessages((rows) => [...rows.slice(-7), { id: ++messageId.current, question: `${player.name} · Weekly outlook · ${formats.find((row) => row.value === nextFormat)?.label}`, report: data, topic: 'overview' }]); }
    } catch (cause) { if (controller.current === next) setError(next.signal.aborted ? 'Player breakdown timed out. Retry.' : cause instanceof Error ? cause.message : 'The breakdown could not load. Retry.'); }
    finally { window.clearTimeout(timer); if (controller.current === next) setBusy(null); }
  }
  function followUp(topic: BotTopic | null, prompt: string) {
    if (!report || busy) return;
    if (report.matchup && report.indication !== 'Game locked' && Date.parse(report.matchup.start) <= Date.now()) {
      void analyze(report.player); return;
    }
    setMessages((rows) => [...rows.slice(-7), { id: ++messageId.current, question: prompt, topic: topic ?? 'overview', report, unsupported: topic === null }]); setQuestion('');
  }
  const query = search.trim().toLocaleLowerCase();
  const matches = query.length >= 2 ? directory?.players.filter((player) => `${player.name} ${player.teamAbbr}`.toLocaleLowerCase().includes(query)).slice(0, 10) ?? [] : [];
  return <section className="gwb" aria-label="GameWire Bot owner preview">
    <button className="gwb-toggle" aria-expanded={open} aria-controls="gamewire-bot-panel" onClick={() => { setOpen(!open); if (!open && !directory && !busy) void loadPlayers(); }}>
      <span className="gwb-brand-icon"><Bot size={28} aria-hidden="true" /></span><span className="gwb-toggle-text"><span className="gwb-eyebrow">GAMEWAIRE LAB · OWNER PREVIEW</span><strong>Meet your <em>GameWire Bot.</em></strong><span>One player. This week. A clearer outlook.</span></span>
      <span className="gwb-open-label">{open ? 'Close' : 'Open Bot'}</span><ChevronDown size={20} className={open ? 'gwb-chevron-open' : ''} aria-hidden="true" />
    </button>
    {open && <div id="gamewire-bot-panel" className="gwb-panel">
      <div className="gwb-mode"><ShieldCheck size={16} aria-hidden="true" /><span>Owner-only · Verified NFL data · Conversational AI not enabled</span></div>
      <div className="gwb-controls"><label>League scoring<select value={format} disabled={!!busy} onChange={(event) => {
        const nextFormat = formats.find((row) => row.value === event.target.value)?.value;
        if (nextFormat) { setFormat(nextFormat); if (selected) void analyze(selected, nextFormat); }
      }}>{formats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="gwb-search-label">Find an NFL player<span><Search size={17} aria-hidden="true" /><input value={search} disabled={!directory || !!busy} placeholder={directory ? 'Search name or team...' : 'Loading NFL players...'} maxLength={80}
          aria-controls="gwb-player-results" onChange={(event) => setSearch(event.target.value)} /></span></label>
        <button className="gwb-icon-button" disabled={!!busy} onClick={() => { void loadPlayers(); }} aria-label="Refresh NFL player search"><RefreshCw size={17} aria-hidden="true" /></button></div>
      {directory?.warnings.map((warning) => <p className="gwb-warning" key={warning}>{warning}</p>)}
      {query.length >= 2 && <div id="gwb-player-results" className="gwb-search-results" aria-label="Matching NFL players">
        {matches.map((player) => <button key={player.id} disabled={!!busy} onClick={() => { void analyze(player); }}><span>{player.name}</span><small>{player.teamAbbr} · {player.position}</small><ArrowUp size={15} aria-hidden="true" /></button>)}
        {!matches.length && directory && <p>No matching player in the loaded rosters. Try a surname or refresh search.</p>}</div>}
      {busy && <p className="gwb-loading" role="status"><Sparkles size={16} aria-hidden="true" />{busy === 'directory' ? 'Loading verified NFL rosters. The first search can take a moment...' : `Checking ${selected?.name}’s weekly workload and published prop coverage...`}</p>}
      {error && <div className="gwb-error" role="alert"><p>{error}</p><button disabled={!!busy} onClick={() => { if (lastAttempt.current === 'report' && selected) void analyze(selected); else void loadPlayers(); }}>Retry</button></div>}
      {!messages.length && !busy && <div className="gwb-welcome"><Bot size={34} aria-hidden="true" /><h4>Your weekly player check-in.</h4><p>Search a QB, RB, WR or TE for a Start/Sit workload guide, recent production and any matching published GamewAIre props. No new odds requests.</p></div>}
      <div className="gwb-conversation" aria-label="Player breakdown conversation">{messages.map((message, index) => <div key={message.id} ref={index === messages.length - 1 ? lastMessage : undefined}>
        <p className="gwb-question">{message.question}</p>{message.unsupported ? <p className="gwb-answer">Conversational AI is not enabled yet. I can show the selected player’s verified weekly outlook, Start/Sit guide, published props or matchup. Use player search to change players.</p>
          : message.report && <Breakdown report={message.report} topic={message.topic} />}</div>)}</div>
      {report && <><div className="gwb-followups" aria-label={`Follow-up topics for ${report.player.name}`}>{topics.map((topic) => <button key={topic.value} disabled={!!busy} onClick={() => followUp(topic.value, `${report.player.name}: ${topic.label}`)}>{topic.label}</button>)}
        <button disabled={!!busy} onClick={() => { void analyze(report.player); }}>Refresh outlook</button></div>
        <form className="gwb-compose" onSubmit={(event) => { event.preventDefault(); if (question.trim()) followUp(botTopic(question), question.trim()); }}><label className="gwb-sr-only" htmlFor="gwb-question">Question about {report.player.name}</label>
          <input id="gwb-question" value={question} maxLength={300} disabled={!!busy} onChange={(event) => setQuestion(event.target.value)} placeholder={`Ask about ${report.player.name}’s usage, props or matchup...`} />
          <button type="submit" disabled={!!busy || !question.trim()} aria-label="Show verified topic"><ArrowUp size={18} aria-hidden="true" /></button></form>
        <p className="gwb-muted gwb-compose-note">Topic-based replies, not generative AI. Questions stay in this tab; nothing is posted or published.</p></>}
    </div>}
  </section>;
}
