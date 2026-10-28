import { useEffect, useState } from 'react';
import { defaultSettings, engineRequest, gamewaireGrade, loadEngineHistory, markets, modelVersion, performance, performanceGroups, probabilityGrade, rankTopPicks } from './services/gamewaire';
import type { AnalysisRun, Candidate, EngineStatus, OddsEvent, PublishedGame, Settings, Sport, StoredPick } from './services/gamewaire';
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
function PickCard({ pick, record, rank, selection }: { pick: Candidate; record?: StoredPick; rank: number;
  selection?: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void } }) {
  const valueScore = gamewaireGrade(pick).score;
  const grade = probabilityGrade(pick.probability);
  const marketLabel = marketLabels[pick.market] ?? pick.market.replace(/_/g, ' ');
  const title = pick.market === 'h2h' ? `${pick.subject} ML`
    : pick.market === 'spreads' ? `${pick.subject}${pick.line === null ? '' : ` ${pick.line > 0 ? '+' : ''}${pick.line}`}`
    : `${pick.subject} · ${pick.side}${pick.line === null ? '' : ` ${pick.line}`} ${marketLabel}`;
  const projectionLabel = pick.market === 'h2h' || pick.market === 'spreads' ? 'team scoring margin'
    : marketLabel.toLowerCase();
  return <article className="gai-pick angle-card" data-selectable={!!selection}>
    {selection && <label className="gai-select-pick"><input type="checkbox" checked={selection.checked} disabled={selection.disabled}
      aria-label={`Select ${title}`} onChange={(event) => selection.onChange(event.target.checked)} /></label>}
    <details className="gai-pick-details">
    <summary className="gai-pick-summary" aria-label={`Why this pick: ${title}`}>
    <div className="gai-pick-top">
      <div className="gai-pick-identity">
        <span className="gai-rank" aria-label={`Rank ${rank}`}>{String(rank).padStart(2, '0')}</span>
        <div><span className="eyebrow">{pick.sport} · {marketLabel}</span>
          <h3>{title}</h3>
          <small>{pick.away} @ {pick.home}</small></div>
      </div>
      <div className="gai-pick-price"><span className={`gai-grade ${pick.probability >= 0.5 ? 'gai-grade-positive' : 'gai-grade-neutral'}`}>Probability grade {grade}</span>
        <b>{odds(pick.american)}</b><small>{pick.book}</small></div>
    </div>
    {record && <p>{record.withdrawn ? 'Withdrawn · not an active selection · ' : ''}Status: {record.result}</p>}
    <dl className="gai-metrics gai-row-metrics">
      <div className="gai-hit"><dt>Estimated hit %</dt><dd>{percent(pick.probability)}</dd></div>
      <div><dt>Market implied</dt><dd>{percent(pick.implied)}</dd></div>
      <div><dt>Edge</dt><dd>+{(pick.edge * 100).toFixed(1)} pp</dd></div>
      <div><dt>Est. EV</dt><dd>+{percent(pick.ev)}</dd></div>
    </dl>
    <p className="gai-note gai-estimate-note">Unvalidated estimate · Not a guarantee of profit.</p>
    {record && record.result !== 'pending' && <p className="gai-note">Saved analysis, not a new live selection.</p>}
    {Date.now() - Date.parse(pick.updatedAt) > 600_000 && <p className="gai-note">Saved price · refresh analysis before using a changed line.</p>}
    <span className="gai-open-cue">Why this pick <span aria-hidden="true">↓</span></span>
    </summary>
    <section className="gai-reason" aria-label={`Analysis behind ${title}`}>
      <h4>Why the model selected this pick</h4>
      <p>At the saved {odds(pick.american)} price from {pick.book}, the model estimated a {percent(pick.probability)} chance of winning,
        compared with {percent(pick.implied)} implied by the odds. Its push-adjusted edge was {(pick.edge * 100).toFixed(1)} percentage points,
        with estimated EV of {percent(pick.ev)} per unit staked, including pushes.</p>
      <p>The weighted baseline for {pick.subject} was {pick.projection.toFixed(1)} {projectionLabel}, using {pick.sampleSize} prior game observations.
        {pick.market.startsWith('player_') && pick.line !== null && <> That projection is {pick.projection === pick.line ? 'equal to'
          : `${Math.abs(pick.projection - pick.line).toFixed(1)} ${projectionLabel} ${pick.projection > pick.line ? 'above' : 'below'}`} the {pick.line} line.</>}
        The available current-season last-five average was {pick.last5.toFixed(1)}, last-ten {pick.last10.toFixed(1)}, and season average {pick.seasonAverage.toFixed(1)}.
        The model combines the weighted game distribution with a four-observation, no-vig sportsbook prior; it does not select on the average alone.</p>
      {pick.baseline && <p className="gai-note">{pick.baseline} Previous full-season average: {pick.previousSeasonAverage?.toFixed(1) ?? 'Unavailable'}. This is a data-method note, not an error.</p>}
    {pick.rotation && <p className="gai-rotation">{pick.rotation.label} · {pick.rotation.minutes.toFixed(1)} recent minutes
      {pick.rotation.involvement !== undefined && ` · ${pick.rotation.involvement.toFixed(1)} offensive involvement`}
      <small>Minutes/usage-ranked, not a confirmed starter.</small></p>}
      <p className="gai-note">Selection screens check edge, EV, conservative uncertainty, data completeness and freshness.
        Probability grades summarize estimates, not value. This experimental model is unvalidated; changed prices, small samples and role changes can change the case for a pick.</p>
      {!!pick.risks.length && <p className="gai-note">Key limitation: {pick.risks[0]}</p>}
    </section>
    <details className="gai-evidence"><summary>Full stats &amp; source observations</summary>
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
    </details>
    </details>
  </article>;
}
function PublishPicks({ report, refresh }: { report: AnalysisRun; refresh: () => void }) {
  const candidates = rankTopPicks(report.payload.picks ?? []);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stale = candidates.some((pick) => Date.now() - Date.parse(pick.updatedAt) > 600_000) || Date.parse(report.event_start) <= Date.now();
  const legacy = candidates.some((pick) => pick.modelVersion !== modelVersion);
  return <section className="gai-publish" aria-label="Choose member picks"><h4>Choose up to four member picks</h4>
    <p className="gai-note">Tap for reasoning. Check up to four picks to publish.</p>
    <div className="gai-picks">{candidates.map((pick, index) => <PickCard key={pick.key} pick={pick} rank={index + 1}
      selection={{ checked: selected.includes(pick.key), disabled: busy || (!selected.includes(pick.key) && selected.length >= 4),
        onChange: (checked) => setSelected((previous) => checked ? [...previous, pick.key] : previous.filter((key) => key !== pick.key)) }} />)}</div>
    {stale && <p className="feed-warning">These prices are stale or the game has started. Run a fresh analysis before publishing.</p>}
    {legacy && <p className="gai-note">Saved under an older model. Generate fresh candidates to apply the current model and ranking before publishing.</p>}
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
  const [pickView, setPickView] = useState<'published' | 'candidates'>('candidates');
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
  const matchingRuns = runs.filter((run) => run.sport === sport && nbaCalendarDate(new Date(run.event_start)) === date
    && (!eventId || run.event_id === eventId));
  const report = matchingRuns.find((run) => run.id === selectedRun) ?? matchingRuns[0];
  const memberGames = published.filter((game) => game.sport === memberSport && nbaCalendarDate(new Date(game.event_start)) === memberDate);
  const memberReport = memberGames.find((game) => game.event_id === memberGame);
  const candidateView = !!status?.canAnalyze && pickView === 'candidates';
  const publishedPicks = rankTopPicks((memberReport ? [memberReport] : memberGames).flatMap((game) => game.picks)).slice(0, 4);
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
    <div className="gai-dashboard">
    <aside className="gai-filters gai-outline" aria-label="Game filters">
    <h3>Game filters</h3>
    {status?.canAnalyze && <div className="gai-view-switch" role="group" aria-label="Pick view">
      <button aria-pressed={!candidateView} onClick={() => setPickView('published')}>Published</button>
      <button aria-pressed={candidateView} onClick={() => setPickView('candidates')}>Admin review</button>
    </div>}
    {!candidateView && <section aria-label="Game picks">
      <div className="gai-form">
        <label>League<select value={memberSport} onChange={(event) => { setMemberSport(event.target.value as Sport); setMemberGame(''); }}><option>NBA</option><option>NFL</option></select></label>
        <label>Game date (Eastern)<input type="date" value={memberDate} onChange={(event) => { setMemberDate(event.target.value); setMemberGame(''); }} /></label>
        <label>Game<select value={memberReport?.event_id ?? ''} onChange={(event) => setMemberGame(event.target.value)}>
          <option value="">All published games</option>
          {memberGames.map((game) => <option key={game.event_id} value={game.event_id}>{game.matchup} · {stamp(game.event_start)}</option>)}
        </select></label>
      </div>
      <p className="gai-note">Saved, admin-published picks. Selecting a game never triggers a paid provider call.</p>
    </section>}
    {candidateView && status && <section className="gai-workspace">
    {!status.oddsReady && <p className="feed-warning" role="status">Sportsbook analysis is unavailable until an admin configures The Odds API on the server. Open provider setup below.</p>}
    <section className="gai-admin" aria-label="Admin analysis controls">
      <form className="gai-form" onSubmit={(event) => { event.preventDefault(); void request('analyze'); }}>
        <label>Sport<select value={sport} disabled={busy} onChange={(event) => changeSport(event.target.value as Sport)}><option>NBA</option><option>NFL</option></select></label>
        <label>Date (Eastern)<input type="date" value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setEvents([]); setEventId(''); }} required /></label>
        <button className="gai-load" type="button" disabled={busy || !date || !status.oddsReady} onClick={() => void request('events')}>Load upcoming games</button>
        <label>Matchup<select value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={busy} required><option value="">Select a game</option>{events.map((event) => <option key={event.id} value={event.id}>{event.away} @ {event.home} · {stamp(event.start)}</option>)}</select></label>
        <details className="gai-advanced"><summary>Analysis settings</summary>
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
        <button className="gai-run" disabled={busy || !eventId || !settings.markets.length || !status.oddsReady}>{busy ? 'Analysis in progress…' : 'Run analysis'}</button>
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
      <p>Calls are cached and limited to 6 requests per admin / 20 site-wide per hour. Only upcoming games. Up to 24 matched players; coverage limits and omissions are disclosed.</p>
      <button onClick={refreshHistory}>Refresh provider status</button>
    </details>
    </section>}
    </aside>
    <section id="gai-top-picks" className="gai-top-picks gai-outline" aria-label="Top Picks">
      <div className="gai-section-heading"><h3><span aria-hidden="true">★</span> Top Picks</h3><span className="gai-tag">{candidateView ? 'Admin candidates · unpublished' : 'Published picks'}</span></div>
      <p className="gai-note">Unvalidated estimates, not betting value. Probability-first; close ties favor moneylines and high-usage players.</p>
      {candidateView ? <section aria-label="Analysis reports">
        {!!matchingRuns.length && <details className="gai-report-picker"><summary>Saved analysis reports</summary><label>Report<select value={report?.id ?? ''} onChange={(event) => setSelectedRun(event.target.value)}>{matchingRuns.map((run) => <option key={run.id} value={run.id}>{run.matchup} · {stamp(run.created_at)} · {statusLabels[run.status]}</option>)}</select></label></details>}
        {loaded && !matchingRuns.length && <div className="gai-empty"><h4>Ready to analyze</h4><p>No model analyses yet for these filters. Choose a game, then run analysis to review up to eight candidates.</p></div>}
        {report && <><h4>{report.matchup}</h4><p role="status">{report.status === 'in_progress' && Date.now() - Date.parse(report.created_at) > 180_000 ? 'Analysis interrupted. Retry this matchup; no completed recommendation is being claimed.' : statusLabels[report.status]}</p>
          {report.status === 'no_qualifying' && <p>No qualifying value bets found for this matchup.</p>}
          {report.payload.error && <p role="alert" className="feed-warning">{report.payload.error}</p>}
          {report.status === 'completed' && !!report.payload.picks?.length && <PublishPicks key={report.id} report={report} refresh={refreshHistory} />}
          <details className="gai-diagnostics"><summary>Data notes &amp; excluded markets</summary>
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
      <p>Probability grades summarize the unrounded estimated win probability: A: 75%+, A-: 70 to below 75%, B+: 65 to below 70%, B: 55 to below 65%, B-: 50 to below 55%, C: below 50%. Green indicates an estimate of at least 50%, not good value or a betting recommendation. Estimates are unvalidated.</p>
      <p>The separate value/quality score is a transparent 0-100 rubric: conservative EV / 15% (40 points), edge / 15 percentage points (25), estimated EV / 25% (20), completeness (15). Each factor is capped at its weight. This heuristic has not been validated against outcomes and is not a probability.</p>
      <p>NBA early season: before 12 current-season games, 50% weight goes to current-season games and 50% to all available previous-season regular-season game logs (minimum 12). At least one recent current-season game is required; no repeated season-average pseudo-games. Current-season-only analysis resumes at 12 games. Recent-10 weighting is paused during the equal blend. NFL still requires 8 current-season games. A four-observation no-vig prior and a conservative one-sided 1.645-standard-error EV check apply. This uncertainty screen is not calibrated confidence.</p>
      <p>NBA player pool: top five by recent minutes among matched offered players, requiring 24+ minutes, plus other players averaging 18+ minutes and 12+ offensive involvement over up to five current-season games. Involvement = field goal attempts + 0.44 x free throw attempts + turnovers; it is a proxy, not official usage percentage. These are rotation estimates, not confirmed starters. Missing involvement cannot qualify a bench player. Active status and stable minutes checks still apply.</p>
      <p>Team markets use season scoring margins or totals, with a simple opponent-margin adjustment. NBA props require reasonably stable minutes; NFL opportunity and injury effects remain uncertain. Completeness is 80% for supported team/NBA data, 75% for NFL props lacking snap-share data, and lower/ineligible for missing identity, status, logs or playing time. No ATS, positional-defense, scheme, home-field or injury coefficient is invented.</p>
      <p>Ranking uses estimated win probability in one-percentage-point bands, then moneyline preference, verified offensive involvement and minutes, exact probability, and value/quality score. Conservative EV, edge and data-quality thresholds remain eligibility requirements. Admins review up to eight qualifying candidates and publish up to four per game. At most one selection per player and one team market; other game-level correlations remain possible. No exact pick quota. Odds older than 10 minutes are rejected; supported data must be fetched within an hour. Model version: empirical-baseline-v4.</p>
      <p>Historical replay tooling rejects future observations and requires pre-event odds/data snapshots. No licensed historical dataset or validated backtest is configured yet. No reliability or profitability claim is made.</p>
    </details>
  </section>;
}
