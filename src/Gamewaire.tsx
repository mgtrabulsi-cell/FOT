import { useEffect, useState } from 'react';
import { defaultSettings, engineRequest, gamewaireGrade, loadEngineHistory, markets, modelVersion, performance, performanceGroups } from './services/gamewaire';
import type { AnalysisRun, Candidate, EngineStatus, OddsEvent, PublishedGame, Settings, Sport, StoredPick } from './services/gamewaire';
import { nbaCalendarDate } from './services/sportsData';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import './gamewaire.css';

export function GamewaireName() { return <span className="gamewaire-name">Gamew<strong>AI</strong>re</span>; }
const percent = (value: number | null) => value === null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;
const odds = (value: number) => value > 0 ? `+${value}` : String(value);
const stamp = (value: string) => new Date(value).toLocaleString();
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'GamewAIre could not be refreshed.';
const statusLabels = {
  in_progress: 'Analysis in progress', completed: 'Analysis completed', no_qualifying: 'No qualifying value bets',
  insufficient_data: 'Insufficient data', stale_odds: 'Stale odds', provider_error: 'Provider error', setup_required: 'Provider setup required',
};
function PickCard({ pick, record }: { pick: Candidate; record?: StoredPick }) {
  const grade = gamewaireGrade(pick);
  return <article className="gai-pick angle-card">
    <div className="gai-pick-top"><span className="eyebrow">{pick.sport} · {pick.market.replace(/_/g, ' ')}</span>
      <span className={`gai-grade gai-grade-${grade.letter.toLowerCase()}`}>Grade {grade.letter} · {grade.score}/100</span></div>
    <h3>{pick.subject} · {pick.side}{pick.line === null ? '' : ` ${pick.line}`}</h3>
    <p>{pick.book} · <b>{odds(pick.american)}</b>
      {pick.baseline && <span className="gai-tag">50/50 season blend</span>}</p>
    {pick.rotation && <p className="gai-rotation">{pick.rotation.label} · {pick.rotation.minutes.toFixed(1)} recent minutes
      {pick.rotation.involvement !== undefined && ` · ${pick.rotation.involvement.toFixed(1)} offensive involvement`}
      <small>Minutes/usage-ranked, not a confirmed starter.</small></p>}
    {record && <p>{record.withdrawn ? 'Withdrawn · not an active selection · ' : ''}Status: {record.result}</p>}
    <dl className="gai-metrics">
      <div className={`gai-grade-${grade.letter.toLowerCase()}`}><dt>GamewAIre grade</dt><dd>{grade.letter} · {grade.score}/100</dd></div>
      <div><dt>Estimated win probability (unvalidated)</dt><dd>{percent(pick.probability)}</dd></div>
      <div><dt>Projection</dt><dd>{pick.projection.toFixed(1)}</dd></div>
    </dl>
    {record && record.result !== 'pending' && <p className="gai-note">Saved analysis, not a new live selection.</p>}
    {Date.now() - Date.parse(pick.updatedAt) > 600_000 && <p className="gai-note">Saved price · refresh analysis before using a changed line.</p>}
    <details><summary>Pick analysis &amp; game logs</summary>
    <dl className="gai-metrics">
      <div><dt>Push probability</dt><dd>{percent(pick.pushProbability)}</dd></div>
      <div><dt>Raw market implied</dt><dd>{percent(pick.implied)}</dd></div>
      <div><dt>No-vig market</dt><dd>{percent(pick.noVig)}</dd></div>
      <div><dt>Decisive-outcome edge</dt><dd>{(pick.edge * 100).toFixed(1)} pp</dd></div>
      <div><dt>Estimated EV / 1 unit</dt><dd>{percent(pick.ev)}</dd></div>
      <div><dt>Conservative EV</dt><dd>{percent(pick.conservativeEV)}</dd></div>
    </dl>
    <p>{pick.explanation}</p>
    {pick.baseline && <p className="gai-note">{pick.baseline} Previous full-season average: {pick.previousSeasonAverage?.toFixed(1) ?? 'Unavailable'}. This is a data-method note, not an error.</p>}
    <small>Odds: {stamp(pick.updatedAt)} · Data retrieved: {stamp(pick.dataAt)}</small>
      <p>{pick.sampleSize} underlying games · Current-season last 5: {pick.last5.toFixed(1)} · Last 10: {pick.last10.toFixed(1)} · Current-season average: {pick.seasonAverage.toFixed(1)}</p>
      <p>Data-completeness rubric: {percent(pick.quality)}. This is not a calibrated confidence or win probability.</p>
      <ul>{pick.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      <div className="gai-table"><table><caption>Underlying prior observations</caption><thead><tr><th>Date</th><th>Season ending</th><th>Opponent</th><th>Location</th><th>Value</th><th>Minutes</th></tr></thead><tbody>
        {pick.samples.map((row, i) => <tr key={`${row.date}:${i}`}><td>{stamp(row.date)}</td><td>{row.season ?? 'Unavailable'}</td><td>{row.opponent || 'Unavailable'}</td><td>{row.location || 'Unavailable'}</td><td>{row.value}</td><td>{row.minutes ?? 'Unavailable'}</td></tr>)}
      </tbody></table></div>
    </details>
  </article>;
}
function PublishPicks({ report, refresh }: { report: AnalysisRun; refresh: () => void }) {
  const candidates = report.payload.picks ?? [];
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stale = candidates.some((pick) => Date.now() - Date.parse(pick.updatedAt) > 600_000) || Date.parse(report.event_start) <= Date.now();
  const legacy = candidates.some((pick) => pick.modelVersion !== modelVersion);
  return <section aria-label="Choose member picks"><h4>Choose up to four member picks</h4>
    <p>Select candidates below, review their cards, then publish. Only published picks enter member views and performance tracking.</p>
    <div className="gai-form">{candidates.map((pick) => <label key={pick.key} className="gai-choice">
      <input type="checkbox" checked={selected.includes(pick.key)} disabled={busy || (!selected.includes(pick.key) && selected.length >= 4)}
        onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, pick.key] : previous.filter((key) => key !== pick.key))} />
      <span>{pick.subject} · {pick.side} {pick.line ?? ''}<small>{pick.market.replace(/_/g, ' ')} · {odds(pick.american)}</small></span>
      <span className={`gai-grade gai-grade-${gamewaireGrade(pick).letter.toLowerCase()}`}>Grade {gamewaireGrade(pick).letter}</span>
    </label>)}</div>
    {stale && <p className="feed-warning">These prices are stale or the game has started. Run a fresh analysis before publishing.</p>}
    {legacy && <p className="gai-note">Saved under an older model. Generate fresh candidates to apply the rotation filter before publishing.</p>}
    <button disabled={busy || stale || legacy || !selected.length} onClick={() => {
      setBusy(true); setError(''); setNotice('');
      void engineRequest({ action: 'publish', runId: report.id, keys: selected })
        .then(() => { setNotice(`${selected.length} picks published for this game.`); refresh(); })
        .catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
    }}>{busy ? 'Publishing…' : `Publish ${selected.length}/4 picks`}</button>
    {error && <p role="alert" className="feed-warning">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
function Settlement({ pick, refresh }: { pick: StoredPick; refresh: () => void }) {
  const [result, setResult] = useState(pick.result), [note, setNote] = useState('');
  const [closing, setClosing] = useState(''), [closingAt, setClosingAt] = useState('');
  const [withdrawn, setWithdrawn] = useState(pick.withdrawn), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <details><summary>Admin: settle or withdraw {pick.subject}</summary><form className="gai-form" onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setError('');
    void engineRequest({ action: 'settle', id: pick.id, revision: pick.revision, result, note, withdrawn,
      closingAmerican: closing ? Number(closing) : null, closingLine: pick.line, closingAt: closingAt ? new Date(closingAt).toISOString() : null })
      .then(refresh).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
  }}>
    <label>Result<select value={result} onChange={(event) => setResult(event.target.value as StoredPick['result'])}>
      {(['pending', 'win', 'loss', 'push', 'void'] as const).map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label>Source / reason<input value={note} onChange={(event) => setNote(event.target.value)} minLength={5} maxLength={1000} required /></label>
    <label>Closing American odds (same line, optional)<input type="number" value={closing} onChange={(event) => setClosing(event.target.value)} /></label>
    <label>Closing-price timestamp (local)<input type="datetime-local" value={closingAt} onChange={(event) => setClosingAt(event.target.value)} required={!!closing} /></label>
    <label><input type="checkbox" checked={withdrawn} onChange={(event) => setWithdrawn(event.target.checked)} />Withdrawn (remains in all-history reporting)</label>
    <button disabled={busy}>{busy ? 'Saving…' : 'Save settlement'}</button>
    {error && <p role="alert" className="feed-warning">{error}</p>}
  </form></details>;
}
export default function Gamewaire() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[]>([]), [picks, setPicks] = useState<StoredPick[]>([]);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [sport, setSport] = useState<Sport>('NBA'), [date, setDate] = useState(nbaCalendarDate);
  const [events, setEvents] = useState<OddsEvent[]>([]), [eventId, setEventId] = useState('');
  const [settings, setSettings] = useState<Settings>({ ...defaultSettings, markets: [...markets.NBA] });
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const [selectedRun, setSelectedRun] = useState(''), [market, setMarket] = useState('all'), [pickStatus, setPickStatus] = useState('all');
  const [minEV, setMinEV] = useState(''), [minOdds, setMinOdds] = useState(''), [maxOdds, setMaxOdds] = useState('');
  const [historySport, setHistorySport] = useState('all'), [historyDate, setHistoryDate] = useState('');
  const [published, setPublished] = useState<PublishedGame[]>([]), [memberGame, setMemberGame] = useState('');
  const [memberSport, setMemberSport] = useState<Sport>('NBA'), [memberDate, setMemberDate] = useState(nbaCalendarDate);
  useEffect(() => subscribeForegroundRefresh(() => setRefresh((value) => value + 1)), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 20_000);
    void engineRequest<EngineStatus>({ action: 'status' }, controller.signal)
      .then(async (nextStatus) => ({ nextStatus, history: await loadEngineHistory(controller.signal, nextStatus.canAnalyze) }))
      .then(({ nextStatus, history }) => { if (!controller.signal.aborted) { setStatus(nextStatus); setRuns(history.runs); setPicks(history.picks); setPublished(history.published); setLoaded(true); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(controller.signal.aborted ? 'GamewAIre refresh timed out. Retry to update saved reports.' : errorMessage(cause)); })
      .finally(() => window.clearTimeout(timeout));
    const poll = window.setInterval(() => { if (document.visibilityState !== 'hidden' && navigator.onLine) setRefresh((value) => value + 1); }, 60_000);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.clearInterval(poll); };
  }, [refresh]);
  const report = runs.find((run) => run.id === selectedRun) ?? runs[0];
  const memberGames = published.filter((game) => game.sport === memberSport && nbaCalendarDate(new Date(game.event_start)) === memberDate);
  const memberReport = memberGames.find((game) => game.event_id === memberGame);
  const refreshHistory = () => setRefresh((value) => value + 1);
  const record = performance(picks.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
    american: pick.american, result: pick.result, closingAmerican: pick.closing_american, withdrawn: pick.withdrawn })));
  const breakdowns = performanceGroups(picks.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
    american: pick.american, result: pick.result, closingAmerican: pick.closing_american, withdrawn: pick.withdrawn,
    sport: pick.sport, market: pick.market, createdAt: pick.created_at, edge: pick.data.edge })));
  const visible = picks.filter((pick) => (historySport === 'all' || pick.sport === historySport) && (!historyDate || nbaCalendarDate(new Date(pick.event_start)) === historyDate)
    && (market === 'all' || pick.market === market) && (pickStatus === 'all' || (pickStatus === 'withdrawn' ? pick.withdrawn : pick.result === pickStatus))
    && (!minEV || pick.data.ev * 100 >= Number(minEV)) && (!minOdds || pick.american >= Number(minOdds)) && (!maxOdds || pick.american <= Number(maxOdds)));
  const request = async (action: 'events' | 'analyze') => {
    setBusy(true); setActionError(''); setNotice('');
    try {
      if (action === 'events') {
        const result = await engineRequest<{ events: OddsEvent[] }>({ action, sport, date });
        setEvents(result.events); setEventId(result.events[0]?.id ?? '');
        if (!result.events.length) setNotice('No upcoming provider-listed games on this Eastern date.');
      } else {
        const result = await engineRequest<{ run: AnalysisRun }>({ action, sport, eventId, settings });
        setSelectedRun(result.run.id); setRuns((previous) => [result.run, ...previous.filter((run) => run.id !== result.run.id)]);
        setNotice(statusLabels[result.run.status]); refreshHistory();
      }
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const changeSport = (value: Sport) => { setSport(value); setEvents([]); setEventId(''); setSettings((previous) => ({ ...previous, markets: [...markets[value]] })); };
  return <section className="gai-panel" aria-label="GamewAIre">
    <header><span className="eyebrow">NFL + NBA · PRICE-AWARE ANALYSIS</span><h2><GamewaireName /></h2>
      <p className="gai-note">Experimental model · Grades are ratings, not certainty. Win estimates are unvalidated. No guarantee of profit.</p></header>
    {error && <p role="alert" className="feed-warning">{error} <button onClick={refreshHistory}>Retry</button></p>}
    {!loaded && !error && <p role="status">Loading saved GamewAIre reports…</p>}
    <section aria-label="Game picks"><h3>Select a game for GamewAIre picks</h3>
      <div className="gai-form">
        <label>League<select value={memberSport} onChange={(event) => { setMemberSport(event.target.value as Sport); setMemberGame(''); }}><option>NBA</option><option>NFL</option></select></label>
        <label>Game date (Eastern)<input type="date" value={memberDate} onChange={(event) => { setMemberDate(event.target.value); setMemberGame(''); }} /></label>
        <label>Game<select value={memberReport?.event_id ?? ''} onChange={(event) => setMemberGame(event.target.value)}>
          <option value="">Select a published game</option>
          {memberGames.map((game) => <option key={game.event_id} value={game.event_id}>{game.matchup} · {stamp(game.event_start)}</option>)}
        </select></label>
      </div>
      {loaded && !memberGames.length && <p>No published picks for this league and date yet. An admin must analyze and publish a game first.</p>}
      {memberGames.length > 0 && !memberReport && <p>Choose a game to see its published picks. Selecting games never triggers a paid provider call.</p>}
      {memberReport && <><h4>{memberReport.matchup}</h4><p>{memberReport.picks.length} published picks · {stamp(memberReport.published_at)}. Grades are model ratings, not confidence percentages.</p>
        <div className="gai-picks">{memberReport.picks.map((pick) => <PickCard key={pick.key} pick={pick}
          record={picks.find((row) => row.data.key === pick.key && row.data.book === pick.book && row.american === pick.american && row.data.modelVersion === pick.modelVersion)} />)}</div></>}
    </section>
    {status?.canAnalyze && <details className="gai-workspace"><summary>Create &amp; manage picks <span className="gai-tag">Admin</span></summary>
    {!status.oddsReady && <p className="feed-warning" role="status">Sportsbook analysis is unavailable until an admin configures The Odds API on the server. Open provider setup below.</p>}
    <section className="gai-admin" aria-label="Admin analysis controls"><h3>Create picks</h3>
      <p>1. Load games &nbsp; 2. Generate candidates &nbsp; 3. Choose up to four and publish</p>
      <form className="gai-form" onSubmit={(event) => { event.preventDefault(); void request('analyze'); }}>
        <label>Sport<select value={sport} disabled={busy} onChange={(event) => changeSport(event.target.value as Sport)}><option>NBA</option><option>NFL</option></select></label>
        <label>Date (Eastern)<input type="date" value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setEvents([]); setEventId(''); }} required /></label>
        <button type="button" disabled={busy || !date || !status.oddsReady} onClick={() => void request('events')}>Load upcoming games</button>
        <label>Matchup<select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={busy} required><option value="">Select a game</option>{events.map((event) => <option key={event.id} value={event.id}>{event.away} @ {event.home} · {stamp(event.start)}</option>)}</select></label>
        <details className="gai-advanced"><summary>Advanced markets and thresholds (defaults are ready)</summary>
        <fieldset><legend>Markets to evaluate</legend>{markets[sport].map((item) => <label key={item}><input type="checkbox" checked={settings.markets.includes(item)} onChange={(event) => setSettings((previous) => ({ ...previous, markets: event.target.checked ? [...previous.markets, item] : previous.markets.filter((market) => market !== item) }))} />{item.replace(/_/g, ' ')}</label>)}</fieldset>
        <label>Directions<select value={settings.direction} onChange={(event) => setSettings((previous) => ({ ...previous, direction: event.target.value as Settings['direction'] }))}><option value="both">Overs and unders</option><option value="over">Overs only</option><option value="under">Unders only</option></select></label>
        <label>Player name filter<input value={settings.player} maxLength={100} onChange={(event) => setSettings((previous) => ({ ...previous, player: event.target.value }))} /></label>
        {([{ key: 'minEV', label: 'Minimum estimated EV %', max: 100 }, { key: 'minEdge', label: 'Minimum probability edge (pp)', max: 50 },
          { key: 'minQuality', label: 'Minimum completeness %', min: 75, max: 100 }, { key: 'recentWeight', label: 'Last-10 weighting %', max: 60 }] as const).map((field) => <label key={field.key}>{field.label}<input type="number" min={'min' in field ? field.min : 0} max={field.max} step="1" value={Math.round(settings[field.key] * 100)} required onChange={(event) => setSettings((previous) => ({ ...previous, [field.key]: Number(event.target.value) / 100 }))} /></label>)}
        </details>
        <button disabled={busy || !eventId || !settings.markets.length || !status.oddsReady}>{busy ? 'Analysis in progress…' : 'Generate up to eight candidates'}</button>
      </form>
      <p className="gai-note">NBA focuses on core rotation and high-usage reserves, not confirmed lineups. Fewer than eight candidates may qualify.</p>
    </section>
    {actionError && <p role="alert" className="feed-warning">{actionError}</p>}
    {(busy || notice) && <p role="status">{busy ? 'Working with verified provider data. Existing reports remain available…' : notice}</p>}
    <section aria-label="Analysis reports"><h3>Saved analysis reports</h3>
      {!!runs.length && <label>Report<select value={report?.id ?? ''} onChange={(event) => setSelectedRun(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.matchup} · {stamp(run.created_at)} · {statusLabels[run.status]}</option>)}</select></label>}
      {loaded && !runs.length && <p>No model analyses yet. Configure providers, then an admin can evaluate a matchup.</p>}
      {report && <><h4>{report.matchup}</h4><p role="status">{report.status === 'in_progress' && Date.now() - Date.parse(report.created_at) > 180_000 ? 'Analysis interrupted. Retry this matchup; no completed recommendation is being claimed.' : statusLabels[report.status]}</p>
        {report.status === 'no_qualifying' && <p>No qualifying value bets found for this matchup.</p>}
        {report.payload.error && <p className="feed-warning">{report.payload.error}</p>}
        {report.status === 'completed' && !!report.payload.picks?.length && <PublishPicks key={report.id} report={report} refresh={refreshHistory} />}
        <div className="gai-picks">{report.payload.picks?.map((pick) => <PickCard key={pick.key} pick={pick} />)}</div>
        <details className="gai-diagnostics"><summary>Data notes &amp; excluded markets</summary>
          {report.payload.warnings?.map((warning) => <p className="gai-note" key={warning}>{warning}</p>)}
          {report.payload.explanationMode && <p className="gai-note">{report.payload.explanationMode}</p>}
          {!!report.payload.rejected?.length && <ul>{report.payload.rejected.map((row, i) => <li key={`${row.key}:${i}`}>{row.key.split('|').slice(1).join(' · ')}: {row.reason}</li>)}</ul>}
        </details>
      </>}
    </section>
    <details><summary>Live data setup and provider status</summary>
      <p>Odds key: {status.oddsReady ? 'Configured (provider connection is verified when games are loaded)' : 'Not configured'}. OpenAI: {status.aiReady ? 'Configured' : 'Optional; deterministic explanations are ready'}.</p>
      <ol>
        <li>Create your own account at <a href="https://the-odds-api.com/#get-access" target="_blank" rel="noreferrer">The Odds API</a>. Confirm NFL/NBA US odds, player-prop coverage and display rights.</li>
        <li>Add <code>ODDS_API_KEY</code> in <a href="https://supabase.com/dashboard/project/cbwhmouuckrqnhvfnaol/functions/secrets" target="_blank" rel="noreferrer">Supabase Edge Function Secrets</a>. Never share it in chat or a browser variable.</li>
      </ol>
      <p>Calls are cached and limited to 6 requests per admin / 20 site-wide per hour. Only upcoming games. Up to 24 matched players; coverage limits and omissions are disclosed.</p>
      <button onClick={refreshHistory}>Refresh provider status</button>
    </details>
    </details>}
    <details className="gai-history"><summary>Results &amp; pick history</summary>
    <section aria-label="Model performance"><h3>All-history model tracking</h3><p>One unit at the recorded odds per unique selection/price. Repeated identical analyses are not counted twice. All settled selections remain included, even if withdrawn. Admin-reported settlements; no historical simulations are mixed in.</p>
      {loaded && <><dl className="gai-metrics">
        <div><dt>Total tracked</dt><dd>{record.total}</dd></div><div><dt>Settled</dt><dd>{record.settled}</dd></div><div><dt>Pending</dt><dd>{record.pending}</dd></div>
        <div><dt>Win rate (excludes pushes)</dt><dd>{percent(record.winRate)}</dd></div><div><dt>Profit / loss</dt><dd>{record.profit.toFixed(2)} units</dd></div>
        <div><dt>ROI</dt><dd>{percent(record.roi)}</dd></div><div><dt>Brier score</dt><dd>{record.brier?.toFixed(3) ?? 'Unavailable'}</dd></div>
        <div><dt>Log loss</dt><dd>{record.logLoss?.toFixed(3) ?? 'Unavailable'}</dd></div><div><dt>Closing price value</dt><dd>{percent(record.closingPriceValue)}</dd></div>
      </dl><p>These are descriptive metrics, not proof of an edge. Calibration requires a meaningful out-of-sample sample size. Closing price value compares prices at the same line, not point-line movement.</p></>}
      {loaded && <details><summary>Performance by sport, market, price, probability, edge and month</summary>{Object.entries(breakdowns).map(([name, groups]) => <div className="gai-table" key={name}><table><caption>{name} breakdown · all eligible tracked selections</caption><thead><tr><th>Group</th><th>Total</th><th>Settled</th><th>ROI</th><th>Predicted probability</th><th>Observed win rate</th><th>Brier</th></tr></thead><tbody>{groups.map((group) => <tr key={group.label}><th scope="row">{group.label}</th><td>{group.total}</td><td>{group.settled}</td><td>{percent(group.roi)}</td><td>{percent(group.predicted)}</td><td>{percent(group.winRate)}</td><td>{group.brier?.toFixed(3) ?? 'Unavailable'}</td></tr>)}</tbody></table></div>)}</details>}
      <div className="gai-form">
        <label>Sport filter<select value={historySport} onChange={(event) => setHistorySport(event.target.value)}><option value="all">All sports</option><option>NFL</option><option>NBA</option></select></label>
        <label>Game date (Eastern)<input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></label>
        <label>Market filter<select value={market} onChange={(event) => setMarket(event.target.value)}><option value="all">All markets</option>{[...new Set(picks.map((pick) => pick.market))].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Pick status<select value={pickStatus} onChange={(event) => setPickStatus(event.target.value)}>{['all', 'pending', 'win', 'loss', 'push', 'void', 'withdrawn'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Minimum EV %<input type="number" value={minEV} onChange={(event) => setMinEV(event.target.value)} /></label>
        <label>Minimum American odds<input type="number" value={minOdds} onChange={(event) => setMinOdds(event.target.value)} /></label>
        <label>Maximum American odds<input type="number" value={maxOdds} onChange={(event) => setMaxOdds(event.target.value)} /></label>
      </div>
      <div className="gai-table"><table><caption>{visible.length} selections matching filters (overall metrics above always include all history)</caption><thead><tr><th>Date</th><th>Sport / market</th><th>Selection</th><th>Odds</th><th>EV</th><th>Result</th></tr></thead><tbody>
        {visible.map((pick) => <tr key={pick.id}><td>{stamp(pick.event_start)}</td><td>{pick.sport} · {pick.market}</td><td>{pick.subject} · {pick.side} {pick.line ?? ''}{status?.canAnalyze && <Settlement key={`${pick.id}:${pick.revision}`} pick={pick} refresh={refreshHistory} />}</td><td>{odds(pick.american)}</td><td>{percent(pick.data.ev)}</td><td>{pick.result}{pick.withdrawn ? ' · withdrawn' : ''}{pick.settlement_note && <small>{pick.settlement_note}</small>}</td></tr>)}
      </tbody></table></div>
    </section>
    </details>
    <details><summary>Methodology and limitations</summary>
      <p>GamewAIre grade is a transparent 0-100 rubric, not a probability: conservative EV / 15% (40 points), edge / 15 percentage points (25), estimated EV / 25% (20), completeness (15). Each factor is capped at its weight. A: 85+, B: 70+, C: 55+, D: below 55. This heuristic has not been validated against outcomes; estimated win probability is shown separately and is also unvalidated.</p>
      <p>NBA early season: before 12 current-season games, 50% weight goes to current-season games and 50% to all available previous-season regular-season game logs (minimum 12). At least one recent current-season game is required; no repeated season-average pseudo-games. Current-season-only analysis resumes at 12 games. Recent-10 weighting is paused during the equal blend. NFL still requires 8 current-season games. A four-observation no-vig prior and a conservative one-sided 1.645-standard-error EV check apply. This uncertainty screen is not calibrated confidence.</p>
      <p>NBA player pool: top five by recent minutes among matched offered players, requiring 24+ minutes, plus other players averaging 18+ minutes and 12+ offensive involvement over up to five current-season games. Involvement = field goal attempts + 0.44 x free throw attempts + turnovers; it is a proxy, not official usage percentage. These are rotation estimates, not confirmed starters. Missing involvement cannot qualify a bench player. Active status and stable minutes checks still apply.</p>
      <p>Team markets use season scoring margins or totals, with a simple opponent-margin adjustment. NBA props require reasonably stable minutes; NFL opportunity and injury effects remain uncertain. Completeness is 80% for supported team/NBA data, 75% for NFL props lacking snap-share data, and lower/ineligible for missing identity, status, logs or playing time. No ATS, positional-defense, scheme, home-field or injury coefficient is invented.</p>
      <p>Ranking uses conservative EV, then estimated EV. Admins review up to eight qualifying candidates and publish up to four per game. At most one selection per player and one team market; other game-level correlations remain possible. No exact pick quota. Odds older than 10 minutes are rejected; supported data must be fetched within an hour. Model version: empirical-baseline-v3.</p>
      <p>Historical replay tooling rejects future observations and requires pre-event odds/data snapshots. No licensed historical dataset or validated backtest is configured yet. No reliability or profitability claim is made.</p>
    </details>
  </section>;
}
