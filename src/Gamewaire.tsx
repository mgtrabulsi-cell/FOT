import { useEffect, useState } from 'react';
import { loadCompletedSavedGames, savedGameKey } from './services/gamewaireGames';
import { defaultSettings, engineRequest, gamewaireGrade, loadEngineHistory, markets, modelVersion, performance, performanceGroups, probabilityGrade, rankTopPicks, pickBlurb } from './services/gamewaire';
import type { AnalysisRun, Candidate, EngineStatus, GameLean, OddsEvent, PublishedGame, ScheduleBatch, ScheduleJob, Settings, Sport, StoredPick } from './services/gamewaire';
import { nbaCalendarDate } from './services/sportsData';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';
import './gamewaire.css';

const percent = (value: number | null) => value === null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;
const odds = (value: number) => value > 0 ? `+${value}` : String(value);
const stamp = (value: string) => new Date(value).toLocaleString();
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'GamewAIre could not be refreshed.';
const statusLabels = {
  in_progress: 'Analysis in progress', completed: 'Analysis completed', no_qualifying: 'No qualifying value bets',
  insufficient_data: 'Insufficient data', stale_odds: 'Stale odds', provider_error: 'Provider error', setup_required: 'Provider setup required',
};
const marketLabels: Record<string, string> = {
  h2h: 'Moneyline', spreads: 'Spread', totals: 'Total points',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: 'Made threes',
  player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards', player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
};
const pickTitle = (pick: Candidate) => pick.market === 'h2h' ? `${pick.subject} ML`
  : pick.market === 'spreads' ? `${pick.subject}${pick.line === null ? '' : ` ${pick.line > 0 ? '+' : ''}${pick.line}`}`
  : `${pick.subject} · ${pick.side}${pick.line === null ? '' : ` ${pick.line}`} ${marketLabels[pick.market] ?? pick.market.replace(/_/g, ' ')}`;
const resultLabels = { pending: 'Pending', win: 'Won', loss: 'Lost', push: 'Push', void: 'Void' };
function PickCard({ pick, record, rank, selection, technical = false }: { pick: Candidate; record?: StoredPick; rank: number; technical?: boolean;
  selection?: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void } }) {
  const valueScore = gamewaireGrade(pick).score;
  const grade = probabilityGrade(pick.probability);
  const marketLabel = marketLabels[pick.market] ?? pick.market.replace(/_/g, ' ');
  const title = pickTitle(pick);
  return <article className="gai-pick angle-card" data-selectable={!!selection}>
    {selection && <label className="gai-select-pick"><input type="checkbox" checked={selection.checked} disabled={selection.disabled}
      aria-label={`Select ${title}`} onChange={(event) => selection.onChange(event.target.checked)} /></label>}
    <details className="gai-pick-details">
    <summary className="gai-pick-summary" aria-label={`Why this pick: ${title}`}>
    <div className="gai-pick-top">
      <div className="gai-pick-identity gai-history-pick">
        <div><span className="eyebrow"><span aria-label={`Rank ${rank}`}>#{String(rank).padStart(2, '0')}</span> · {pick.sport} · {marketLabel}</span>
          <h3>{title}</h3>
          <small>{pick.away} @ {pick.home} · {stamp(pick.start)}</small></div>
      </div>
      <div className="gai-history-price"><b>{odds(pick.american)}</b><small>{pick.book}</small></div>
      <span className={`gai-grade ${pick.probability >= 0.5 ? 'gai-grade-positive' : 'gai-grade-neutral'}`}>Probability grade {grade}</span>
    </div>
    <div className="gai-pick-footer">
      {record?.withdrawn && <span className="gai-tag">Withdrawn · not an active selection</span>}
      {record && <span className={`gai-result gai-result-${record.result}`}>{resultLabels[record.result]}</span>}
      {Date.now() - Date.parse(pick.updatedAt) > 600_000 && <span className="gai-note">Saved price</span>}
      <span className="gai-open-cue">Why this pick <span aria-hidden="true">↓</span></span>
    </div>
    </summary>
    <div className="gai-pick-context">
    {technical && <dl className="gai-metrics gai-row-metrics">
      <div className="gai-hit"><dt>Estimated hit %</dt><dd>{percent(pick.probability)}</dd></div>
      <div><dt>Market implied</dt><dd>{percent(pick.implied)}</dd></div>
      <div><dt>Edge</dt><dd>+{(pick.edge * 100).toFixed(1)} pp</dd></div>
      <div><dt>Est. EV</dt><dd>+{percent(pick.ev)}</dd></div>
    </dl>}
    <p className="gai-note gai-estimate-note">Unvalidated estimate · Not a guarantee of profit.</p>
    {record && record.result !== 'pending' && <p className="gai-note">Saved analysis, not a new live selection.</p>}
    {Date.now() - Date.parse(pick.updatedAt) > 600_000 && <p className="gai-note">Saved price · refresh analysis before using a changed line.</p>}
    </div>
    <section className="gai-reason" aria-label={`Analysis behind ${title}`}>
      <p>{pickBlurb(pick)}</p>
    </section>
    {technical && <details className="gai-evidence"><summary>Admin stats &amp; source observations</summary>
    {pick.baseline && <p>{pick.baseline} Previous full-season average: {pick.previousSeasonAverage?.toFixed(1) ?? 'Unavailable'}.</p>}
    <dl className="gai-metrics">
      <div><dt>Value/quality score (not probability)</dt><dd>{valueScore}/100</dd></div>
      <div><dt>Estimated win probability (unvalidated)</dt><dd>{percent(pick.probability)}</dd></div>
      <div><dt>Projection</dt><dd>{pick.projection.toFixed(1)}</dd></div>
      <div><dt>Push probability</dt><dd>{percent(pick.pushProbability)}</dd></div>
      <div><dt>Raw market implied</dt><dd>{percent(pick.implied)}</dd></div>
      <div><dt>No-vig market</dt><dd>{percent(pick.noVig)}</dd></div>
      <div><dt>Decisive-outcome edge</dt><dd>{(pick.edge * 100).toFixed(1)} pp</dd></div>
      <div><dt>Estimated EV / 1 unit</dt><dd>{percent(pick.ev)}</dd></div>
      <div><dt>Conservative EV</dt><dd>{percent(pick.conservativeEV)}</dd></div>
    </dl>
    <p>Saved model explanation: {pick.explanation}</p>
    <small>Odds: {stamp(pick.updatedAt)} · Data retrieved: {stamp(pick.dataAt)}</small>
      <p>{pick.sampleSize} underlying games · Current-season last 5: {pick.last5.toFixed(1)} · Last 10: {pick.last10.toFixed(1)} · Current-season average: {pick.seasonAverage.toFixed(1)}</p>
      <p>Data-completeness rubric: {percent(pick.quality)}. This is not a calibrated confidence or win probability.</p>
      <ul>{pick.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      <div className="gai-table"><table><caption>Underlying prior observations</caption><thead><tr><th>Date</th><th>Season ending</th><th>Opponent</th><th>Location</th><th>Value</th><th>Minutes</th></tr></thead><tbody>
        {pick.samples.map((row, i) => <tr key={`${row.date}:${i}`}><td>{stamp(row.date)}</td><td>{row.season ?? 'Unavailable'}</td><td>{row.opponent || 'Unavailable'}</td><td>{row.location || 'Unavailable'}</td><td>{row.value}</td><td>{row.minutes ?? 'Unavailable'}</td></tr>)}
      </tbody></table></div>
    </details>}
    </details>
  </article>;
}
function PublishPicks({ report, refresh, onFreshReport }: { report: AnalysisRun; refresh: () => void; onFreshReport: (run: AnalysisRun) => void }) {
  const candidates = rankTopPicks(report.payload.picks ?? []);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stale = candidates.some((pick) => Date.now() - Date.parse(pick.updatedAt) > 600_000) || Date.parse(report.event_start) <= Date.now();
  const legacy = candidates.some((pick) => pick.modelVersion !== modelVersion);
  return <section className="gai-publish" aria-label="Choose member picks"><h4>Choose up to four member picks</h4>
    <p className="gai-note">Tap for reasoning. Check up to four picks to publish.</p>
    <div className="gai-picks">{candidates.map((pick, index) => <PickCard key={pick.key} pick={pick} rank={index + 1} technical
      selection={{ checked: selected.includes(pick.key), disabled: busy || (!selected.includes(pick.key) && selected.length >= 4),
        onChange: (checked) => setSelected((previous) => checked ? [...previous, pick.key] : previous.filter((key) => key !== pick.key)) }} />)}</div>
    {stale && <p className="gai-note">{Date.parse(report.event_start) <= Date.now() ? 'This game has started; this report cannot be published.'
      : 'Saved shortlist: prices must be refreshed before publishing. Refresh once, review the new candidates, then select your picks.'}</p>}
    {legacy && <p className="gai-note">Saved under an older model. Generate fresh candidates to apply the current model and ranking before publishing.</p>}
    {(stale || legacy) && Date.parse(report.event_start) > Date.now() && <button disabled={busy} onClick={() => {
      setBusy(true); setError(''); setNotice('');
      void engineRequest<{ run: AnalysisRun; cached?: boolean }>({ action: 'analyze', sport: report.sport, eventId: report.event_id, settings: report.settings })
        .then(({ run, cached }) => { setSelected([]); setNotice(cached ? 'Reused a fresh report; no additional Odds API credits used.' : 'Prices refreshed. Review the candidates before publishing.'); onFreshReport(run); refresh(); })
        .catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
    }}>{busy ? 'Refreshing…' : `Refresh prices & review picks · up to ${new Set([...report.settings.markets, 'h2h', 'spreads']).size} credits`}</button>}
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
function ReviewGameLean({ report, refresh, onFreshReport }: { report: AnalysisRun; refresh: () => void; onFreshReport: (run: AnalysisRun) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lean = report.payload.teamLean;
  const started = Date.parse(report.event_start) <= Date.now();
  const stale = !lean || Date.now() - Date.parse(lean.pick.updatedAt) > 600_000
    || Date.now() - Date.parse(lean.pick.dataAt) > 3_600_000 || lean.pick.modelVersion !== modelVersion;
  const analyze = async (players: boolean) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const { run } = await engineRequest<{ run: AnalysisRun }>({ action: 'analyze', sport: report.sport, eventId: report.event_id,
        settings: { ...report.settings, player: '', markets: players ? [...markets[report.sport]] : ['h2h', 'spreads'] } });
      onFreshReport(run); refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <section aria-label="Review game lean">
    <h4>Game lean · review before publishing</h4>
    <p className="gai-note">NBA and NFL analyses stay private until you publish. Game leans are moneyline/spread only and are separate from Top Picks.</p>
    {lean ? <><p className="gai-note">{lean.reason}</p><PickCard pick={lean.pick} rank={1} technical /></>
      : <p>No verified game lean is available in this report. Missing data is not replaced with a forced pick.</p>}
    {stale && !started && <p className="gai-note">Saved prices/data need refreshing before publication. Refreshing only the game lean never requests player markets.</p>}
    <div className="gai-actions">
      <button disabled={busy || started || stale} onClick={() => {
        setBusy(true); setError(''); setNotice('');
        void engineRequest({ action: 'publishLean', runId: report.id })
          .then(() => { setNotice('Game lean published · 0 additional credits.'); refresh(); })
          .catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setBusy(false));
      }}>Publish game lean · 0 credits</button>
    </div>
    <details className="gai-review-tools"><summary>Refresh prices or analyze players</summary>
      <button disabled={busy || started} onClick={() => void analyze(false)}>Refresh game lean only · up to 2 credits</button>
      <button disabled={busy || started} onClick={() => void analyze(true)}>Analyze players &amp; full game · up to 7 credits</button>
    </details>
    {started && <p className="gai-note">This game has started; it can no longer be analyzed or published.</p>}
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
  const [memberSport, setMemberSport] = useState<Sport | 'all'>('NBA'), [memberDate, setMemberDate] = useState(nbaCalendarDate);
  const [pickView, setPickView] = useState<'published' | 'candidates'>('candidates');
  const [leans, setLeans] = useState<GameLean[]>([]);
  const [batches, setBatches] = useState<ScheduleBatch[]>([]), [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [completion, setCompletion] = useState<{ completed: string[]; completionWarning: string }>({ completed: [], completionWarning: '' });
  useEffect(() => subscribeForegroundRefresh(() => setRefresh((value) => value + 1)), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 20_000);
    void engineRequest<EngineStatus>({ action: 'status' }, controller.signal)
      .then(async (nextStatus) => ({ nextStatus, history: await loadEngineHistory(controller.signal, nextStatus.canAnalyze) }))
      .then(({ nextStatus, history }) => { if (!controller.signal.aborted) { setStatus(nextStatus); setRuns(history.runs); setPicks(history.picks); setPublished(history.published); setLeans(history.leans); setBatches(history.batches); setJobs(history.jobs); setLoaded(true); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(controller.signal.aborted ? 'GamewAIre refresh timed out. Retry to update saved reports.' : errorMessage(cause)); })
      .finally(() => window.clearTimeout(timeout));
    const poll = window.setInterval(() => { if (document.visibilityState !== 'hidden' && navigator.onLine) setRefresh((value) => value + 1); }, 60_000);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.clearInterval(poll); };
  }, [refresh]);
  useEffect(() => {
    if (!status?.canAnalyze) return;
    const controller = new AbortController();
    void loadCompletedSavedGames([...runs, ...jobs], controller.signal).then((next) => {
      if (!controller.signal.aborted) setCompletion((previous) => ({
        completed: [...new Set([...previous.completed, ...next.completed])], completionWarning: next.completionWarning,
      }));
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        console.error('Could not update saved game statuses', cause);
        setCompletion((previous) => ({ ...previous, completionWarning: 'Game statuses could not update. Unconfirmed games remain in saved review; reconnect or retry.' }));
      }
    });
    return () => controller.abort();
  }, [runs, jobs, status?.canAnalyze]);
  const reviewRuns = runs.filter((run) => !completion.completed.includes(savedGameKey(run)));
  const reviewJobs = jobs.filter((job) => !completion.completed.includes(savedGameKey(job)));
  const matchingRuns = reviewRuns.filter((run) => run.sport === sport && nbaCalendarDate(new Date(run.event_start)) === date
    && (!eventId || run.event_id === eventId));
  const report = matchingRuns.find((run) => run.id === selectedRun) ?? matchingRuns[0];
  const memberGames = published.filter((game) => (memberSport === 'all' || game.sport === memberSport) && nbaCalendarDate(new Date(game.event_start)) === memberDate);
  const memberReport = memberGames.find((game) => game.event_id === memberGame);
  const candidateView = !!status?.canAnalyze && pickView === 'candidates';
  const publishedPicks = rankTopPicks((memberGame ? (memberReport ? [memberReport] : []) : memberGames).flatMap((game) => game.picks)).slice(0, 4);
  const visibleLeans = leans.filter((game) => (memberSport === 'all' || game.sport === memberSport) && nbaCalendarDate(new Date(game.event_start)) === memberDate
    && (!memberGame || game.event_id === memberGame));
  const gameOptions = [...memberGames, ...leans.filter((game) => (memberSport === 'all' || game.sport === memberSport)
    && nbaCalendarDate(new Date(game.event_start)) === memberDate && !memberGames.some((publishedGame) => publishedGame.event_id === game.event_id))];
  const refreshHistory = () => setRefresh((value) => value + 1);
  const openReport = (run: AnalysisRun) => {
    setSport(run.sport); setDate(nbaCalendarDate(new Date(run.event_start))); setEventId(run.event_id); setSettings(run.settings);
    setSelectedRun(run.id); setRuns((previous) => [run, ...previous.filter((saved) => saved.id !== run.id)]); setPickView('candidates');
    setNotice('Opened saved analysis · 0 additional credits. Prices are the saved snapshot; refreshing prices is optional and may use credits.');
    window.requestAnimationFrame(() => document.getElementById('gai-top-picks')?.scrollIntoView({
      block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }));
  };
  const savedGames = reviewRuns.filter((run, index) => run.status !== 'in_progress'
    && reviewRuns.findIndex((other) => other.sport === run.sport && other.event_id === run.event_id && other.status !== 'in_progress') === index);
  const historyPicks = picks.filter((pick) => historySport === 'all' || pick.sport === historySport);
  const record = performance(historyPicks.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
    american: pick.american, result: pick.result, closingAmerican: pick.closing_american, withdrawn: pick.withdrawn })));
  const breakdowns = performanceGroups(historyPicks.map((pick) => ({ probability: pick.probability, pushProbability: pick.push_probability,
    american: pick.american, result: pick.result, closingAmerican: pick.closing_american, withdrawn: pick.withdrawn,
    sport: pick.sport, market: pick.market, createdAt: pick.created_at, edge: pick.data.edge })));
  const visible = picks.filter((pick) => (historySport === 'all' || pick.sport === historySport) && (!historyDate || nbaCalendarDate(new Date(pick.event_start)) === historyDate)
    && (market === 'all' || pick.market === market) && (pickStatus === 'all' || (pickStatus === 'withdrawn' ? pick.withdrawn : pick.result === pickStatus))
    && (!minEV || pick.data.ev * 100 >= Number(minEV)) && (!minOdds || pick.american >= Number(minOdds)) && (!maxOdds || pick.american <= Number(maxOdds)))
    .sort((a, b) => Date.parse(b.event_start) - Date.parse(a.event_start) || a.id.localeCompare(b.id));
  const request = async (action: 'events' | 'analyze') => {
    setBusy(true); setActionError(''); setNotice('');
    try {
      if (action === 'events') {
        const result = await engineRequest<{ events: OddsEvent[] }>({ action, sport, date });
        setEvents(result.events); setEventId(result.events[0]?.id ?? '');
        if (!result.events.length) setNotice('No upcoming provider-listed games on this Eastern date.');
      } else {
        const result = await engineRequest<{ run: AnalysisRun; cached?: boolean }>({ action, sport, eventId, settings });
        setSelectedRun(result.run.id); setRuns((previous) => [result.run, ...previous.filter((run) => run.id !== result.run.id)]);
        setNotice(result.cached ? 'Reused a fresh report; no additional Odds API credits used.' : statusLabels[result.run.status]); refreshHistory();
        if (window.matchMedia('(max-width: 760px)').matches) window.requestAnimationFrame(() =>
          document.getElementById('gai-top-picks')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
      }
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const changeSport = (value: Sport) => { setSport(value); setEvents([]); setEventId(''); setSettings((previous) => ({ ...previous, markets: [...markets[value]] })); };
  return <section className="gai-panel" aria-label="GamewAIre">
    <header className="gai-hero">
      <div className="gai-hero-copy"><span className="eyebrow">NFL + NBA · MODEL-DRIVEN INSIGHTS</span>
        <h2>THE <em>ANALYSIS ENGINE</em></h2>
        <p>Data. Matchups. A clearer view.</p>
        <small>Compare real prices and model estimates. No forced picks. No promise of profit.</small></div>
      <div className="gai-hero-features" aria-label="Analysis features">
        <div><b>01</b><span>Sportsbook<br />lines &amp; prices</span></div>
        <div><b>02</b><span>Statistical<br />analysis</span></div>
        <div><b>03</b><span>Moneylines &amp;<br />rotation players</span></div>
        <div><b>04</b><span>Transparent<br />model ratings</span></div>
      </div>
    </header>
    {error && <p role="alert" className="feed-warning">{error} <button onClick={refreshHistory}>Retry</button></p>}
    {!loaded && !error && <p role="status">Loading saved GamewAIre reports…</p>}
    {status?.canAnalyze && <section id="gai-saved-games" className="gai-scheduled" aria-label="Saved analyses">
      <h3>Saved analyses · 0 credits to open</h3>
      <p className="gai-note">Choose a game to review. Finished games leave this list; published results stay saved.</p>
      {completion.completionWarning && <p role="status" className="feed-warning">{completion.completionWarning} <button onClick={refreshHistory}>Retry status check</button></p>}
      {!savedGames.length && <p className="gai-note">No saved games awaiting review.</p>}
      <label className="gai-saved-chooser">Saved game
        <select value={report && savedGames.some((run) => run.id === report.id) ? report.id : ''} disabled={busy || !savedGames.length}
          onChange={(event) => {
            const run = savedGames.find((saved) => saved.id === event.target.value);
            if (run) openReport(run);
          }}>
          <option value="">Select a saved analysis · 0 credits</option>
          {savedGames.map((run) => <option key={run.id} value={run.id}>{run.sport} · {run.matchup} · {stamp(run.event_start)} · {statusLabels[run.status]}</option>)}
        </select>
      </label>
      <details className="gai-schedule-details"><summary>Scheduled shortlists &amp; job status</summary>
      <details><summary>Schedule &amp; analysis costs · 1 AM Eastern</summary>
      <p className="gai-note">NBA and NFL: every upcoming game each day, moneyline/spread only, up to 2 credits per game. Game leans stay private until you review and publish; player markets run only when you explicitly request them.
        Accessing saved reports costs 0. Jobs run once, one at a time; missing markets or failures are not automatically retried. No game lean or Top Pick publishes automatically.</p></details>
      {!batches.length && <p>No scheduled batches yet. The next batch starts at 1 AM Eastern.</p>}
      {batches.filter((batch) => batch.status !== 'ready' || reviewJobs.some((job) => job.batch_id === batch.id)).map((batch) => <section key={batch.id} className="gai-scheduled-batch"><h3>{batch.sport} · {batch.game_date}</h3>
        <p className="gai-note">{batch.note} {batch.status === 'no_games' ? 'No upcoming games in this window.' : ''}</p>
        {batch.error && <p role="alert" className="feed-warning">{batch.error}</p>}
        <ul className="gai-history-list">{reviewJobs.filter((job) => job.batch_id === batch.id).map((job) => <li key={job.id} className="gai-scheduled-row">
          <div className="gai-history-pick"><h4>{job.matchup}</h4><small>{stamp(job.event_start)} · {job.status}</small>
            {job.error && <p className="feed-warning">{job.error}</p>}</div>
          {job.run_id && <button disabled={busy} onClick={() => {
            setBusy(true); setActionError('');
            void engineRequest<{ run: AnalysisRun }>({ action: 'report', runId: job.run_id })
              .then(({ run }) => openReport(run)).catch((cause: unknown) => setActionError(errorMessage(cause))).finally(() => setBusy(false));
          }}>Review saved report · 0 credits</button>}
        </li>)}</ul>
      </section>)}
      </details>
      {actionError && <p role="alert" className="feed-warning">{actionError}</p>}
    </section>}
    <div className="gai-dashboard">
    <aside className="gai-filters gai-outline" aria-label="Game filters">
    <h3>Game filters</h3>
    {status?.canAnalyze && <div className="gai-view-switch" role="group" aria-label="Pick view">
      <button aria-pressed={!candidateView} onClick={() => setPickView('published')}>Published</button>
      <button aria-pressed={candidateView} onClick={() => setPickView('candidates')}>Admin review</button>
    </div>}
    {!candidateView && <section aria-label="Game picks">
      <div className="gai-form">
        <label>Game date (Eastern)<input type="date" value={memberDate} onChange={(event) => { setMemberDate(event.target.value); setMemberGame(''); }} /></label>
        <label>Game<select value={memberGame} onChange={(event) => setMemberGame(event.target.value)}>
          <option value="">All analyzed games</option>
          {gameOptions.map((game) => <option key={game.event_id} value={game.event_id}>{game.matchup} · {stamp(game.event_start)}</option>)}
        </select></label>
      </div>
      <p className="gai-note">Saved, admin-published picks. Selecting a game never triggers a paid provider call.</p>
    </section>}
    {candidateView && status && <details className="gai-workspace"><summary>New analysis &amp; settings</summary>
    {!status.oddsReady && <p className="feed-warning" role="status">Sportsbook analysis is unavailable until an admin configures The Odds API on the server. Open provider setup below.</p>}
    <section className="gai-admin" aria-label="Admin analysis controls">
      <form className="gai-form" onSubmit={(event) => { event.preventDefault(); void request('analyze'); }}>
        <label>Sport<select value={sport} disabled={busy} onChange={(event) => changeSport(event.target.value as Sport)}><option>NBA</option><option>NFL</option></select></label>
        <label>Date (Eastern)<input type="date" value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setEvents([]); setEventId(''); }} required /></label>
        <button className="gai-load" type="button" disabled={busy || !date || !status.oddsReady} onClick={() => void request('events')}>Load upcoming games</button>
        <label>Matchup<select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={busy} required><option value="">Select a game</option>
          {report && report.event_id === eventId && !events.some((event) => event.id === eventId) && <option value={eventId}>{report.matchup} · {stamp(report.event_start)} · Saved report</option>}
          {events.map((event) => <option key={event.id} value={event.id}>{event.away} @ {event.home} · {stamp(event.start)}</option>)}</select></label>
        <details className="gai-advanced"><summary>Analysis settings</summary>
        <p className="gai-note">Moneyline and spread evidence is always checked for a separate game lean. Failed-value leans never enter Top Picks.</p>
        <fieldset className="gai-market-switches"><legend>Analysis settings</legend>
          {[
            { label: 'Moneyline (game winner)', group: ['h2h'] },
            { label: 'Player props', group: markets[sport].filter((item) => item.startsWith('player_')) },
            { label: 'Totals / spreads', group: ['totals', 'spreads'] },
          ].map(({ label, group }) => <label key={label}><input type="checkbox" checked={group.some((item) => settings.markets.includes(item))}
            onChange={(event) => setSettings((previous) => ({ ...previous, markets: event.target.checked
              ? [...new Set([...previous.markets, ...group])] : previous.markets.filter((item) => !group.includes(item)) }))} />{label}</label>)}
        </fieldset>
        <fieldset><legend>Individual markets</legend>{markets[sport].map((item) => <label key={item}><input type="checkbox" checked={settings.markets.includes(item)} onChange={(event) => setSettings((previous) => ({ ...previous, markets: event.target.checked ? [...previous.markets, item] : previous.markets.filter((market) => market !== item) }))} />{item.replace(/_/g, ' ')}</label>)}</fieldset>
        <label>Directions<select value={settings.direction} onChange={(event) => setSettings((previous) => ({ ...previous, direction: event.target.value as Settings['direction'] }))}><option value="both">Overs and unders</option><option value="over">Overs only</option><option value="under">Unders only</option></select></label>
        <label>Player name filter<input value={settings.player} maxLength={100} onChange={(event) => setSettings((previous) => ({ ...previous, player: event.target.value }))} /></label>
        {([{ key: 'minEV', label: 'Minimum estimated EV %', max: 100 }, { key: 'minEdge', label: 'Minimum probability edge (pp)', max: 50 },
          { key: 'minQuality', label: 'Minimum completeness %', min: 75, max: 100 }, { key: 'recentWeight', label: 'Last-10 weighting %', max: 60 }] as const).map((field) => <label key={field.key}>{field.label}<input type="number" min={'min' in field ? field.min : 0} max={field.max} step="1" value={Math.round(settings[field.key] * 100)} required onChange={(event) => setSettings((previous) => ({ ...previous, [field.key]: Number(event.target.value) / 100 }))} /></label>)}
        <p className="gai-note">NBA focuses on core rotation and high-usage reserves, not confirmed lineups. Fewer than eight candidates may qualify.</p>
        </details>
        <button className="gai-run" disabled={busy || !eventId || !settings.markets.length || !status.oddsReady}>{busy ? 'Analysis in progress…' : `Run analysis · up to ${new Set([...settings.markets, 'h2h', 'spreads']).size} credits`}</button>
        <p className="gai-note">Odds API estimate for one game. Only returned markets are charged; reusing a fresh cached report costs 0 credits. Player filters do not reduce market costs.</p>
      </form>
    </section>
    {actionError && <p role="alert" className="feed-warning">{actionError}</p>}
    {(busy || notice) && <p role="status">{busy ? 'Working with verified provider data. Existing reports remain available…' : notice}</p>}
    <details className="gai-provider"><summary>Live data setup and provider status</summary>
      <p>Odds key: {status.oddsReady ? 'Configured (provider connection is verified when games are loaded)' : 'Not configured'}. OpenAI: {status.aiReady ? 'Configured' : 'Optional; deterministic explanations are ready'}.</p>
      <ol>
        <li>Create your own account at <a href="https://the-odds-api.com/#get-access" target="_blank" rel="noreferrer">The Odds API</a>. Confirm NFL/NBA US odds, player-prop coverage and display rights.</li>
        <li>Add <code>ODDS_API_KEY</code> in <a href="https://supabase.com/dashboard/project/cbwhmouuckrqnhvfnaol/functions/secrets" target="_blank" rel="noreferrer">Supabase Edge Function Secrets</a>. Never share it in chat or a browser variable.</li>
      </ol>
      <p>Manual fresh analyses are limited to 6 per admin / 20 site-wide per hour, resetting on the hour. Scheduled jobs have a separate once-per-game allowance. Loading game lists, opening saved reports and publishing do not use that allowance. Only upcoming games. Up to 24 matched players; coverage limits and omissions are disclosed.</p>
      <button onClick={refreshHistory}>Refresh provider status</button>
    </details>
    </details>}
    </aside>
    <section id="gai-top-picks" className="gai-top-picks gai-outline" aria-label="Top Picks">
      <div className="gai-section-heading"><h3><span aria-hidden="true">★</span> Top Picks</h3><span className="gai-tag">{candidateView ? 'Admin candidates · unpublished' : 'Published picks'}</span></div>
      {!candidateView && <div className="gai-sport-tabs" role="group" aria-label="Published sport">
        {(['all', 'NBA', 'NFL'] as const).map((league) => <button key={league} aria-pressed={memberSport === league}
          onClick={() => { setMemberSport(league); setMemberGame(''); }}>{league === 'all' ? 'All sports' : league}</button>)}
      </div>}
      {candidateView ? <section aria-label="Analysis reports">
        <a className="gai-back-games" href="#gai-saved-games" onClick={(event) => {
          event.preventDefault(); document.getElementById('gai-saved-games')?.scrollIntoView({ block: 'start',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }}>Choose another saved game · 0 credits</a>
        {!!matchingRuns.length && <details className="gai-report-picker"><summary>Saved analysis reports</summary><label>Report<select value={report?.id ?? ''} onChange={(event) => setSelectedRun(event.target.value)}>{matchingRuns.map((run) => <option key={run.id} value={run.id}>{run.matchup} · {stamp(run.created_at)} · {statusLabels[run.status]}</option>)}</select></label></details>}
        {loaded && !matchingRuns.length && <div className="gai-empty"><h4>Ready to analyze</h4><p>No model analyses yet for these filters. Choose a game, then run analysis to review up to eight candidates.</p></div>}
        {report && <><h4>{report.matchup}</h4><p className="gai-note">Saved report · 0 credits to view picks and explanations. Refreshing prices is optional and may use credits.</p><p role="status">{report.status === 'in_progress' && Date.now() - Date.parse(report.created_at) > 180_000 ? 'Analysis interrupted. Retry this matchup; no completed recommendation is being claimed.' : statusLabels[report.status]}</p>
          {report.status === 'no_qualifying' && <p>No qualifying value bets found for this matchup.</p>}
          {report.payload.error && <p role="alert" className="feed-warning">{report.payload.error}</p>}
          <ReviewGameLean key={`lean:${report.id}`} report={report} refresh={refreshHistory} onFreshReport={openReport} />
          {report.status === 'completed' && !!report.payload.picks?.length && <details className="gai-top-pick-tools"><summary>Top Pick candidates · select &amp; publish</summary><PublishPicks key={report.id} report={report} refresh={refreshHistory} onFreshReport={openReport} /></details>}
          {report.status !== 'in_progress' && !report.payload.picks?.length && Date.parse(report.event_start) > Date.now() && <button disabled={busy} onClick={() => {
            setBusy(true); setActionError('');
            void engineRequest<{ run: AnalysisRun; cached?: boolean }>({ action: 'analyze', sport: report.sport, eventId: report.event_id, settings: report.settings })
              .then(({ run, cached }) => { openReport(run); setNotice(cached ? 'Reused a fresh report; no additional Odds API credits used.' : statusLabels[run.status]); refreshHistory(); })
              .catch((cause: unknown) => setActionError(errorMessage(cause))).finally(() => setBusy(false));
          }}>Refresh this game · up to {new Set([...report.settings.markets, 'h2h', 'spreads']).size} credits</button>}
          <details className="gai-diagnostics"><summary>Data notes &amp; excluded markets</summary>
            {report.payload.scheduled && <p className="gai-note">Overnight shortlist · {report.payload.scheduled.selectionNote} Saved {stamp(report.created_at)}.</p>}
            {report.payload.providerUsage && <p className="gai-note">Odds API: {report.payload.providerUsage.requestCost ?? 'Unknown'} credits for this saved request · {report.payload.providerUsage.creditsRemaining ?? 'Unknown'} remaining as of {stamp(report.payload.providerUsage.checkedAt)}. Opening this report uses no credits.</p>}
            {report.payload.warnings?.map((warning) => <p className="gai-note" key={warning}>{warning}</p>)}
            {report.payload.explanationMode && <p className="gai-note">{report.payload.explanationMode}</p>}
            {!!report.payload.rejected?.length && <ul>{report.payload.rejected.map((row, i) => <li key={`${row.key}:${i}`}>{row.key.split('|').slice(1).join(' · ')}: {row.reason}</li>)}</ul>}
          </details>
        </>}
      </section> : <>
        {memberReport && <p>{memberReport.matchup} · Published {stamp(memberReport.published_at)}</p>}
        {loaded && !publishedPicks.length && <div className="gai-empty"><h4>No published picks yet</h4><p>No published picks for this league and date yet. An admin must analyze and publish a game first.</p></div>}
        <div className="gai-picks">{publishedPicks.map((pick, index) => <PickCard key={`${pick.key}:${pick.book}:${pick.american}`} pick={pick} rank={index + 1}
          record={picks.find((row) => row.data.key === pick.key && row.data.book === pick.book && row.american === pick.american && row.data.modelVersion === pick.modelVersion)} />)}</div>
        <section aria-label="Game team leans"><h4>Game team leans</h4>
          <p className="gai-note">One data-supported moneyline or spread per game. NBA and NFL leans appear only after owner review and publication. Leans are separate from Top Picks and are not betting recommendations.</p>
          {!visibleLeans.length && <p className="gai-note">No team analyses saved for these filters yet. An admin must analyze each game first.</p>}
          {visibleLeans.map((game) => <section key={game.event_id} className="gai-team-lean"><h4>{game.matchup}</h4>
            <p className="gai-note">{game.team_lean ? game.team_lean.qualifies ? 'Passed model screens when analyzed; not an admin-published Top Pick.'
              : <><strong>Lean only · Not a Top Pick.</strong> {game.team_lean.reason}</> : 'Unavailable: verified team data or a complete fresh market was insufficient.'}</p>
            {game.team_lean && <PickCard pick={game.team_lean.pick} rank={1} />}
          </section>)}
        </section>
      </>}
    </section>
    <aside className="gai-why gai-outline" aria-label="How picks are ranked">
      <h3>Behind the picks</h3>
      <ul><li>Actual sportsbook lines and prices</li><li>Estimated hit probability drives ranking</li><li>Moneylines favored on close ties</li><li>High-usage rotation players prioritized</li><li>Value and data checks before selection</li></ul>
      <div className="gai-callout"><b>Smarter data.<br />Clearer decisions.</b><p>No guaranteed outcomes. A higher hit estimate does not necessarily mean better value at the offered odds.</p></div>
      <details><summary>Ranking explained</summary><p>Probabilities are grouped into one-percentage-point bands. Within a band, moneylines come first, then higher recorded offensive involvement and minutes. Popularity itself is not a measured model input. Lower-probability bands never jump ahead because of player fame or market type.</p>
        <p>Moneylines must pass the same edge, EV, uncertainty and freshness checks as props. No market is forced into the list. NBA rotation rankings are not confirmed starters.</p></details>
    </aside>
    </div>
    <details className="gai-history"><summary>Results &amp; pick history</summary>
    <section aria-label="Model performance">
      <div className="gai-results-heading"><div><span className="eyebrow">THE RECORD</span><h3>Published pick results</h3></div>
        <label>Results sport<select value={historySport} onChange={(event) => setHistorySport(event.target.value)}><option value="all">All sports</option><option>NBA</option><option>NFL</option></select></label>
      </div>
      <p className="gai-note">Results are recorded by an admin, not automatically settled. Pending picks stay pending until reviewed.</p>
      {loaded && <dl className="gai-results-stats">
        <div><dt>Record</dt><dd>{historyPicks.filter((pick) => pick.result === 'win').length}<span> W · </span>{historyPicks.filter((pick) => pick.result === 'loss').length}<span> L</span></dd></div>
        <div><dt>Pending</dt><dd>{record.pending}</dd></div>
        <div><dt>Win rate</dt><dd>{percent(record.winRate)}</dd></div>
        <div className={record.profit > 0 ? 'gai-profit-positive' : record.profit < 0 ? 'gai-profit-negative' : ''}><dt>Profit / loss</dt><dd>{record.profit > 0 ? '+' : ''}{record.profit.toFixed(2)}<span> units</span></dd></div>
        <div><dt>ROI</dt><dd>{percent(record.roi)}</dd></div>
      </dl>}
      <p className="gai-note">Summary: all {historySport === 'all' ? 'sports' : historySport} history · 1 unit per recorded pick. Win rate excludes pushes and voids. Withdrawn settled picks remain included.</p>
      <div className="gai-history-toolbar">
        <label>Game date (Eastern)<input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></label>
        <label>Result<select value={pickStatus} onChange={(event) => setPickStatus(event.target.value)}><option value="all">All results</option>
          {Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="withdrawn">Withdrawn</option></select></label>
        <button onClick={() => { setHistoryDate(''); setPickStatus('all'); setMarket('all'); setMinEV(''); setMinOdds(''); setMaxOdds(''); }}>Clear filters</button>
      </div>
      <details className="gai-history-advanced"><summary>More filters</summary><div className="gai-form">
        <label>Market<select value={market} onChange={(event) => setMarket(event.target.value)}><option value="all">All markets</option>{[...new Set(picks.map((pick) => pick.market))].map((item) => <option key={item} value={item}>{marketLabels[item] ?? item.replace(/_/g, ' ')}</option>)}</select></label>
        <label>Minimum EV %<input type="number" value={minEV} onChange={(event) => setMinEV(event.target.value)} /></label>
        <label>Minimum American odds<input type="number" value={minOdds} onChange={(event) => setMinOdds(event.target.value)} /></label>
        <label>Maximum American odds<input type="number" value={maxOdds} onChange={(event) => setMaxOdds(event.target.value)} /></label>
      </div></details>
      <div className="gai-history-list-heading"><h4>Pick history</h4><span className="gai-tag">{visible.length} matching picks · newest games first</span></div>
      {!loaded && <p role="status">Loading pick history…</p>}
      {loaded && !visible.length && <p className="gai-history-empty">No published picks match these filters.</p>}
      <ul className="gai-history-list" aria-label="Published pick history">
        {visible.map((pick) => <li key={pick.id} className="gai-history-row">
          <div className="gai-history-pick"><span className="eyebrow">{pick.sport} · {marketLabels[pick.market] ?? pick.market.replace(/_/g, ' ')}</span>
            <h4>{pickTitle(pick.data)}</h4><small>{pick.data.away} @ {pick.data.home} · {stamp(pick.event_start)}</small>
            {pick.withdrawn && <span className="gai-tag">Withdrawn</span>}
          </div>
          <div className="gai-history-price"><b>{odds(pick.american)}</b><small>{pick.data.book}</small></div>
          <span className={`gai-result gai-result-${pick.result}`}>{resultLabels[pick.result]}</span>
          {(pick.settlement_note || status?.canAnalyze) && <div className="gai-history-actions">
            {pick.settlement_note && <details><summary>Settlement note</summary><p>{pick.settlement_note}</p></details>}
            {status?.canAnalyze && <Settlement key={`${pick.id}:${pick.revision}`} pick={pick} refresh={refreshHistory} />}
          </div>}
        </li>)}
      </ul>
      {loaded && <details className="gai-history-advanced"><summary>Model diagnostics &amp; breakdowns</summary>
        <p className="gai-note">{record.total} tracked · {record.settled} settled. Repeated identical selections are counted once. Admin-reported outcomes only; no simulated results.</p>
        <dl className="gai-metrics"><div><dt>Brier score</dt><dd>{record.brier?.toFixed(3) ?? 'Unavailable'}</dd></div>
          <div><dt>Log loss</dt><dd>{record.logLoss?.toFixed(3) ?? 'Unavailable'}</dd></div><div><dt>Closing price value</dt><dd>{percent(record.closingPriceValue)}</dd></div></dl>
        <p className="gai-note">These descriptive metrics are not proof of an edge. Closing price value compares prices at the same line, not line movement. Breakdowns follow the selected sport, not the list filters.</p>
        {Object.entries(breakdowns).map(([name, groups]) => <div className="gai-table" key={name}><table><caption>{name} breakdown</caption><thead><tr><th>Group</th><th>Total</th><th>Settled</th><th>ROI</th><th>Predicted probability</th><th>Observed win rate</th><th>Brier</th></tr></thead><tbody>{groups.map((group) => <tr key={group.label}><th scope="row">{group.label}</th><td>{group.total}</td><td>{group.settled}</td><td>{percent(group.roi)}</td><td>{percent(group.predicted)}</td><td>{percent(group.winRate)}</td><td>{group.brier?.toFixed(3) ?? 'Unavailable'}</td></tr>)}</tbody></table></div>)}
      </details>}
    </section>
    </details>
    <details><summary>Methodology and limitations</summary>
      <p>Probability grades summarize the unrounded estimated win probability: A: 75%+, A-: 70 to below 75%, B+: 65 to below 70%, B: 55 to below 65%, B-: 50 to below 55%, C: below 50%. Green indicates an estimate of at least 50%, not good value or a betting recommendation. Estimates are unvalidated.</p>
      <p>The separate value/quality score is a transparent 0-100 rubric: conservative EV / 15% (40 points), edge / 15 percentage points (25), estimated EV / 25% (20), completeness (15). Each factor is capped at its weight. This heuristic has not been validated against outcomes and is not a probability.</p>
      <p>NBA early season: before 12 current-season games, 50% weight goes to current-season games and 50% to all available previous-season regular-season game logs (minimum 12). At least one recent current-season game is required; no repeated season-average pseudo-games. Current-season-only analysis resumes at 12 games. Recent-10 weighting is paused during the equal blend. NFL still requires 8 current-season games. A four-observation no-vig prior and a conservative one-sided 1.645-standard-error EV check apply. This uncertainty screen is not calibrated confidence.</p>
      <p>NBA player pool: top five by recent minutes among matched offered players, requiring 24+ minutes, plus other players averaging 18+ minutes and 12+ offensive involvement over up to five current-season games. Involvement = field goal attempts + 0.44 x free throw attempts + turnovers; it is a proxy, not official usage percentage. These are rotation estimates, not confirmed starters. Missing involvement cannot qualify a bench player. Active status and stable minutes checks still apply.</p>
      <p>Team markets use season scoring margins or totals, with a simple opponent-margin adjustment. NBA props require reasonably stable minutes; NFL opportunity and injury effects remain uncertain. Completeness is 80% for supported team/NBA data, 75% for NFL props lacking snap-share data, and lower/ineligible for missing identity, status, logs or playing time. No ATS, positional-defense, scheme, home-field or injury coefficient is invented.</p>
      <p>Ranking uses estimated win probability in one-percentage-point bands, then moneyline preference, verified offensive involvement and minutes, exact probability, and value/quality score. One qualifying moneyline/spread slot is reserved per candidate pool; unsupported or failed-value team leans remain separate from Top Picks. Conservative EV, edge and data-quality thresholds remain eligibility requirements. Admins review up to eight qualifying candidates and publish up to four per game. At most one selection per player and one team market; other game-level correlations remain possible. No exact pick quota. Odds older than 10 minutes are rejected; supported data must be fetched within an hour. Model version: {modelVersion}.</p>
      <p>Historical replay tooling rejects future observations and requires pre-event odds/data snapshots. No licensed historical dataset or validated backtest is configured yet. No reliability or profitability claim is made.</p>
    </details>
  </section>;
}
