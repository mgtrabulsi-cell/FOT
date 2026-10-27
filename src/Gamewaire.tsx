import { useEffect, useState } from 'react';
import { defaultSettings, engineRequest, loadEngineHistory, markets, performance, performanceGroups } from './services/gamewaire';
import type { AnalysisRun, Candidate, EngineStatus, OddsEvent, Settings, Sport, StoredPick } from './services/gamewaire';
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
function PickCard({ pick }: { pick: Candidate }) {
  return <article className="gai-pick angle-card">
    <span className="eyebrow">{pick.sport} · EXPERIMENTAL MODEL</span>
    <h3>{pick.subject} · {pick.side}{pick.line === null ? '' : ` ${pick.line}`}</h3>
    <p>{pick.market.replace(/_/g, ' ')} · {pick.book} · <b>{odds(pick.american)}</b></p>
    <dl className="gai-metrics">
      <div><dt>Win probability</dt><dd>{percent(pick.probability)}</dd></div>
      <div><dt>Push probability</dt><dd>{percent(pick.pushProbability)}</dd></div>
      <div><dt>Raw market implied</dt><dd>{percent(pick.implied)}</dd></div>
      <div><dt>No-vig market</dt><dd>{percent(pick.noVig)}</dd></div>
      <div><dt>Decisive-outcome edge</dt><dd>{(pick.edge * 100).toFixed(1)} pp</dd></div>
      <div><dt>Estimated EV / 1 unit</dt><dd>{percent(pick.ev)}</dd></div>
      <div><dt>Conservative EV</dt><dd>{percent(pick.conservativeEV)}</dd></div>
      <div><dt>Projection</dt><dd>{pick.projection.toFixed(1)}</dd></div>
    </dl>
    <p>{pick.explanation}</p>
    <small>Odds: {stamp(pick.updatedAt)} · Data retrieved: {stamp(pick.dataAt)}</small>
    {Date.now() - Date.parse(pick.updatedAt) > 600_000 && <p className="feed-warning">Historical analysis: these odds are stale. A changed line/price requires a fresh evaluation.</p>}
    <details><summary>Evidence, game logs and risks</summary>
      <p>{pick.sampleSize} prior games · Last 5: {pick.last5.toFixed(1)} · Last 10: {pick.last10.toFixed(1)} · Season: {pick.seasonAverage.toFixed(1)}</p>
      <p>Data-completeness rubric: {percent(pick.quality)}. This is not a calibrated confidence or win probability.</p>
      <ul>{pick.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      <div className="gai-table"><table><caption>Underlying prior observations</caption><thead><tr><th>Date</th><th>Opponent</th><th>Location</th><th>Value</th><th>Minutes</th></tr></thead><tbody>
        {pick.samples.map((row, i) => <tr key={`${row.date}:${i}`}><td>{stamp(row.date)}</td><td>{row.opponent || 'Unavailable'}</td><td>{row.location || 'Unavailable'}</td><td>{row.value}</td><td>{row.minutes ?? 'Unavailable'}</td></tr>)}
      </tbody></table></div>
    </details>
  </article>;
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
  useEffect(() => subscribeForegroundRefresh(() => setRefresh((value) => value + 1)), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 20_000);
    void Promise.all([engineRequest<EngineStatus>({ action: 'status' }, controller.signal), loadEngineHistory(controller.signal)])
      .then(([nextStatus, history]) => { if (!controller.signal.aborted) { setStatus(nextStatus); setRuns(history.runs); setPicks(history.picks); setLoaded(true); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(controller.signal.aborted ? 'GamewAIre refresh timed out. Retry to update saved reports.' : errorMessage(cause)); })
      .finally(() => window.clearTimeout(timeout));
    const poll = window.setInterval(() => { if (document.visibilityState !== 'hidden' && navigator.onLine) setRefresh((value) => value + 1); }, 60_000);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.clearInterval(poll); };
  }, [refresh]);
  const report = runs.find((run) => run.id === selectedRun) ?? runs[0];
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
      <p>Experimental statistical analysis with verified sportsbook lines. No forced picks, no invented data, and no promise of profit. Not financial advice.</p></header>
    <p className="feed-warning">This baseline has not been calibrated or validated out of sample. Early-season or incomplete data will often produce no picks. Never treat model estimates as certainty.</p>
    {error && <p role="alert" className="feed-warning">{error} <button onClick={refreshHistory}>Retry</button></p>}
    {!loaded && !error && <p role="status">Loading saved GamewAIre reports…</p>}
    {status && (!status.oddsReady || !status.aiReady) && <p className="feed-warning" role="status">
      {!status.oddsReady && 'Sportsbook analysis is unavailable until an admin configures The Odds API on the server. '}
      {!status.aiReady && 'OpenAI is not configured; available model results use deterministic, verified explanations.'}
    </p>}
    {status?.canAnalyze && <details open className="gai-admin"><summary>Admin analysis controls</summary>
      <form className="gai-form" onSubmit={(event) => { event.preventDefault(); void request('analyze'); }}>
        <label>Sport<select value={sport} disabled={busy} onChange={(event) => changeSport(event.target.value as Sport)}><option>NBA</option><option>NFL</option></select></label>
        <label>Date (Eastern)<input type="date" value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setEvents([]); setEventId(''); }} required /></label>
        <button type="button" disabled={busy || !date || !status.oddsReady} onClick={() => void request('events')}>Load upcoming games</button>
        <label>Matchup<select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={busy} required><option value="">Select a game</option>{events.map((event) => <option key={event.id} value={event.id}>{event.away} @ {event.home} · {stamp(event.start)}</option>)}</select></label>
        <fieldset><legend>Markets to evaluate</legend>{markets[sport].map((item) => <label key={item}><input type="checkbox" checked={settings.markets.includes(item)} onChange={(event) => setSettings((previous) => ({ ...previous, markets: event.target.checked ? [...previous.markets, item] : previous.markets.filter((market) => market !== item) }))} />{item.replace(/_/g, ' ')}</label>)}</fieldset>
        <label>Directions<select value={settings.direction} onChange={(event) => setSettings((previous) => ({ ...previous, direction: event.target.value as Settings['direction'] }))}><option value="both">Overs and unders</option><option value="over">Overs only</option><option value="under">Unders only</option></select></label>
        <label>Player name filter<input value={settings.player} maxLength={100} onChange={(event) => setSettings((previous) => ({ ...previous, player: event.target.value }))} /></label>
        {([{ key: 'minEV', label: 'Minimum estimated EV %', max: 100 }, { key: 'minEdge', label: 'Minimum probability edge (pp)', max: 50 },
          { key: 'minQuality', label: 'Minimum completeness %', min: 75, max: 100 }, { key: 'recentWeight', label: 'Last-10 weighting %', max: 60 }] as const).map((field) => <label key={field.key}>{field.label}<input type="number" min={'min' in field ? field.min : 0} max={field.max} step="1" value={Math.round(settings[field.key] * 100)} required onChange={(event) => setSettings((previous) => ({ ...previous, [field.key]: Number(event.target.value) / 100 }))} /></label>)}
        <button disabled={busy || !eventId || !settings.markets.length || !status.oddsReady}>{busy ? 'Analysis in progress…' : 'Analyze exact current lines'}</button>
      </form>
      <p>Calls are cached and limited to 6 requests per admin / 20 site-wide per hour. Only upcoming games. Up to 24 matched players; coverage limits and omissions are disclosed.</p>
    </details>}
    {status && !status.canAnalyze && <p className="nfl-data-note">Admin-generated reports and model history are available below. Only admins can run paid analyses.</p>}
    {actionError && <p role="alert" className="feed-warning">{actionError}</p>}
    {(busy || notice) && <p role="status">{busy ? 'Working with verified provider data. Existing reports remain available…' : notice}</p>}
    <section aria-label="Analysis reports"><h3>Saved analysis reports</h3>
      {!!runs.length && <label>Report<select value={report?.id ?? ''} onChange={(event) => setSelectedRun(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.matchup} · {stamp(run.created_at)} · {statusLabels[run.status]}</option>)}</select></label>}
      {loaded && !runs.length && <p>No model analyses yet. Configure providers, then an admin can evaluate a matchup.</p>}
      {report && <><h4>{report.matchup}</h4><p role="status">{report.status === 'in_progress' && Date.now() - Date.parse(report.created_at) > 180_000 ? 'Analysis interrupted. Retry this matchup; no completed recommendation is being claimed.' : statusLabels[report.status]}</p>
        {report.status === 'no_qualifying' && <p>No qualifying value bets found for this matchup.</p>}
        {report.payload.error && <p className="feed-warning">{report.payload.error}</p>}
        {report.payload.warnings?.map((warning) => <p className="nfl-data-note" key={warning}>{warning}</p>)}
        {report.payload.explanationMode && <p className="nfl-data-note">{report.payload.explanationMode}</p>}
        <div className="gai-picks">{report.payload.picks?.map((pick) => <PickCard key={pick.key} pick={pick} />)}</div>
        {!!report.payload.rejected?.length && <details><summary>Why other markets did not qualify ({report.payload.rejected.length})</summary><ul>{report.payload.rejected.map((row, i) => <li key={`${row.key}:${i}`}>{row.key.split('|').slice(1).join(' · ')}: {row.reason}</li>)}</ul></details>}
      </>}
    </section>
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
    <details><summary>Methodology and limitations</summary>
      <p>Empirical regular-season distribution, 12-game NBA / 8-game NFL minimum, with configurable recent-10 weighting and a four-observation no-vig market prior. Actual price and exact line are evaluated independently. Push mass is retained; edge compares conditional win probability with raw implied probability. Selections must also pass a conservative one-sided 1.645-standard-error EV check. This uncertainty screen is not calibrated confidence.</p>
      <p>Team markets use season scoring margins or totals, with a simple opponent-margin adjustment. NBA props require reasonably stable minutes; NFL opportunity and injury effects remain uncertain. Completeness is 80% for supported team/NBA data, 75% for NFL props lacking snap-share data, and lower/ineligible for missing identity, status, logs or playing time. No ATS, positional-defense, scheme, home-field or injury coefficient is invented.</p>
      <p>Ranking uses conservative EV, then estimated EV. At most one selection per player and one team market; other game-level correlations remain possible. No exact pick quota. Odds older than 10 minutes are rejected; supported data must be fetched within an hour. Model version: empirical-baseline-v1.</p>
      <p>Historical replay tooling rejects future observations and requires pre-event odds/data snapshots. No licensed historical dataset or validated backtest is configured yet. No reliability or profitability claim is made.</p>
    </details>
  </section>;
}
