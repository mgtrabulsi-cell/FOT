import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftRight, Bot, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { loadBotDirectory, loadBotReport, readDirectorySnapshot } from './services/gamewireBot';
import type { BotFormat, BotReport } from './services/gamewireBot';
import { loadNBAPlayerLabDirectory, loadNBAPlayerLabReport, readNBAPlayerLabDirectory } from './services/nbaPlayerLab';
import type { NBAPlayerLabReport } from './services/nbaPlayerLab';
import { findLabPlayers, labPlayerKey } from './services/playerLabChat';
import type { LabPlayer } from './services/playerLabChat';
import { nbaStatValue } from './services/nbaStats';
import { subscribeRenderSnapshots } from './services/renderSnapshots';
import { subscribeForegroundRefresh } from './services/foregroundRefresh';

type Outlook = { player: LabPlayer; nfl?: BotReport; nba?: NBAPlayerLabReport; error?: string };
const initialPlayers = (): LabPlayer[] => {
  const nfl = readDirectorySnapshot(), nba = readNBAPlayerLabDirectory();
  return [...(nfl?.players.map(player => ({ sport: 'NFL' as const, player })) ?? []),
    ...(nba ? nba.players.map(player => ({ sport: 'NBA' as const, player, season: nba.season })) : [])];
};
const metrics = [
  { label: 'PTS', projected: 'points', recorded: 'points' },
  { label: 'REB', projected: 'rebounds', recorded: 'rebounds' },
  { label: 'AST', projected: 'assists', recorded: 'assists' },
  { label: 'PRA', projected: 'pra', recorded: 'pra' },
  { label: '3PM', projected: 'threePointers', recorded: 'threePointersMade' },
] as const;
const number = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value.toFixed(1) : 'Unavailable';

export function NBAPlayerCard({ report, onClear }: { report: NBAPlayerLabReport; onClear: () => void }) {
  const { player, projection, game } = report;
  return <article className="gwb-answer">
    <header className="gwb-player-card-heading">
      {player.headshot && <img className="gwb-player-headshot" src={player.headshot} alt="" />}
      <div><span className="gwb-hero-kicker">NBA · {player.team.abbr} · {player.position}</span>
        <h4>{player.name}</h4><p>{player.team.name}</p></div>
      <button type="button" className="gwb-clear-player" aria-label={`Clear ${player.name}`} onClick={onClear}><X size={18} /></button>
    </header>
    <h5>Saved matchup projections</h5>
    <p>{game ? `${game.away.abbr} @ ${game.home.abbr} · ${new Date(game.date).toLocaleString()}`
      : 'No verified matchup on today’s scoreboard. No matchup projection available.'}</p>
    <div className="gwb-player-projections" aria-label="NBA saved matchup projections">
      {metrics.map(metric => <div key={metric.label}><span>{metric.label}</span>
        <strong>{number(projection?.stats[metric.projected]?.mean)}</strong>
        <small>{projection?.stats[metric.projected] ? `10th–90th: ${number(projection.stats[metric.projected]?.p10)}–${number(projection.stats[metric.projected]?.p90)}` : 'No saved estimate'}</small>
      </div>)}
    </div>
    <p className="gwb-muted">Saved forecast: {report.forecastAt ? new Date(report.forecastAt).toLocaleString() : 'Unavailable'}.
      {' '}Experimental matchup estimates, not recorded results or recommendations.</p>
    {!projection && <p className="gwb-warning">No supported saved projection for this player. Missing values are not estimated.</p>}
    <p>Availability: {projection?.status || 'Unverified; check the official game-day injury report.'}</p>
    {projection && <><p>{projection.matchup}</p><p className="gwb-muted">{projection.games} model reference games.
      {projection.excluded ? ' Player excluded by the saved availability snapshot.' : ''}
      {projection.limited ? ' Limited model coverage.' : ''}</p></>}
    {report.issues.map((issue, index) => <p className="gwb-warning" key={index}>{issue}</p>)}
    <h5>Recorded season averages · {report.season}</h5>
    <div className="gwb-player-projections">{metrics.map(metric => <div key={metric.label}><span>{metric.label}</span>
      <strong>{number(report.profile ? nbaStatValue(report.profile.averages, metric.recorded) : undefined)}</strong></div>)}</div>
    <h5>Recorded recent games</h5>
    <div className="gwb-player-log"><table><thead><tr><th>Date / opponent</th>{metrics.map(metric => <th key={metric.label}>{metric.label}</th>)}</tr></thead>
      <tbody>{report.profile?.games.slice(0, 15).map(game => <tr key={game.id}><th>{new Date(game.date).toLocaleDateString()} / {game.opponent}</th>
        {metrics.map(metric => <td key={metric.label}>{number(nbaStatValue(game.stats, metric.recorded))}</td>)}</tr>)}</tbody></table></div>
    {!report.profile?.games.length && <p>No verified game log is available.</p>}
    <p className="gwb-muted">Sources: ESPN roster, scoreboard and recorded stats; saved GamewAIre matchup model. Availability and forecasts are snapshots, not a live injury feed.</p>
  </article>;
}

export default function PlayerLabCards({ renderNFL }: { renderNFL: (report: BotReport, remove: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [players, setPlayers] = useState(initialPlayers);
  const [format, setFormat] = useState<BotFormat>('ppr'), [outlooks, setOutlooks] = useState<Array<Outlook | null>>([null, null]);
  const [comparing, setComparing] = useState(false), [slot, setSlot] = useState(0);
  const [loadingDirectory, setLoadingDirectory] = useState(false), [busy, setBusy] = useState(false), [issues, setIssues] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null), pending = useRef(false), searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; pending.current = false; }, []);
  useEffect(() => subscribeRenderSnapshots(() => {
    const saved = initialPlayers();
    setPlayers(previous => [...new Map([...previous, ...saved].map(player => [labPlayerKey(player), player])).values()]);
  }, { kind: 'nbaRoster' }), []);
  useEffect(() => {
    if (!open) return;
    return subscribeForegroundRefresh(() => { if (!pending.current) setRevision(value => value + 1); });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController(), failures: string[] = [];
    const timer = setTimeout(() => { controller.abort(); if (active) {
      setLoadingDirectory(false); setIssues(previous => [...previous, 'Player search refresh timed out. Saved players remain available; use Refresh players.']);
    } }, 90_000);
    setLoadingDirectory(true); setIssues([]);
    function merge(rows: LabPlayer[], sport: LabPlayer['sport']) {
      if (!active || controller.signal.aborted) return;
      setPlayers(previous => [...new Map([...previous.filter(row => row.sport !== sport), ...rows].map(row => [labPlayerKey(row), row])).values()]);
    }
    const nfl = loadBotDirectory(controller.signal).then(result => {
      merge(result.players.map(player => ({ sport: 'NFL', player })), 'NFL');
      failures.push(...result.warnings.map(issue => `NFL: ${issue}`));
    }, cause => { if (!controller.signal.aborted) failures.push(`NFL search: ${cause instanceof Error ? cause.message : 'Unavailable'}`); });
    const nba = loadNBAPlayerLabDirectory(controller.signal, result => {
      merge(result.players.map(player => ({ sport: 'NBA', player, season: result.season })), 'NBA');
    }).then(result => { failures.push(...result.issues.map(issue => `NBA: ${issue}`)); },
      cause => { if (!controller.signal.aborted) failures.push(`NBA search: ${cause instanceof Error ? cause.message : 'Unavailable'}`); });
    void Promise.all([nfl, nba]).finally(() => {
      clearTimeout(timer);
      if (active && !controller.signal.aborted) { setLoadingDirectory(false); setIssues(failures); }
    });
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [open, revision]);

  async function load(entries: Array<{ player: LabPlayer; slot: number }>, scoring = format) {
    if (pending.current) return;
    const controller = new AbortController(); request.current = controller; pending.current = true; setBusy(true); setSearch('');
    setOutlooks(previous => previous.map((row, index) => {
      const entry = entries.find(entry => entry.slot === index);
      return entry ? { player: entry.player } : row;
    }));
    const timer = setTimeout(() => {
      controller.abort();
      if (request.current === controller) {
        setOutlooks(previous => previous.map((row, index) => entries.some(entry => entry.slot === index) && row
          ? { ...row, error: 'Player outlook timed out. Retry loading this player.' } : row));
        request.current = null; pending.current = false; setBusy(false);
      }
    }, 75_000);
    try {
      await Promise.all(entries.map(async ({ player, slot }) => {
        let result: Outlook;
        try {
          result = player.sport === 'NFL'
            ? { player, nfl: await loadBotReport(player.player.id, scoring, controller.signal) }
            : { player, nba: await loadNBAPlayerLabReport(player.player, player.season, controller.signal) };
        } catch (cause) { result = { player, error: cause instanceof Error ? cause.message : 'Source unavailable. Retry.' }; }
        if (!controller.signal.aborted) setOutlooks(previous => previous.map((row, index) => index === slot ? result : row));
      }));
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; pending.current = false; setBusy(false); } }
  }
  function clear(index: number) {
    if (pending.current) return;
    setOutlooks(previous => previous.map((row, current) => current === index ? null : row));
    setSlot(index); searchInput.current?.focus();
  }
  const matches = search.trim().length >= 2 ? findLabPlayers(search, players).filter(player =>
    !comparing || labPlayerKey(player) !== (outlooks[1 - slot] ? labPlayerKey(outlooks[1 - slot]!.player) : '')).slice(0, 10) : [];
  return <section className="gwb" aria-label="GamewAIre player analysis">
    <header className="gwb-hero"><div className="gwb-hero-main">
      <div className="gwb-hero-robot" aria-hidden="true"><Bot /></div>
      <div className="gwb-hero-copy"><div className="gwb-wordmark">Gamew<strong>AI</strong>re</div>
        <span className="gwb-hero-kicker">NFL + NBA PLAYER ANALYSIS</span>
        <div className="gwb-hero-title"><h3>Your Gamew<strong>AI</strong>re Player Lab.</h3></div>
        <p>Original player cards and projected stats. One shared search.</p></div>
      <button type="button" className="gwb-toggle" aria-expanded={open} aria-controls="gamewire-bot-panel" onClick={() => setOpen(value => !value)}>
        {open ? 'Close' : 'Open Lab'}<ChevronDown size={18} /></button>
    </div><div className="gwb-hero-footer">
      <form className="gwb-hero-search" onSubmit={event => {
        event.preventDefault(); setOpen(true); if (matches.length === 1 && !busy) void load([{ player: matches[0], slot }]);
      }}>
        <Search size={22} aria-hidden="true" /><label className="gwb-sr-only" htmlFor="gwb-player-search">Find an NFL or NBA player</label>
        <input id="gwb-player-search" ref={searchInput} value={search} disabled={busy} maxLength={80}
          placeholder="Search by first or last name..." aria-controls={open ? 'gwb-player-results' : undefined}
          onFocus={() => setOpen(true)} onChange={event => { setSearch(event.target.value); setOpen(true); }} />
        <button type="submit" disabled={busy} aria-label="Search NFL and NBA players"><Search size={20} /></button>
      </form>
      {open && search.trim().length >= 2 && <div id="gwb-player-results" className="gwb-search-results" aria-label="Matching NFL and NBA players">
        {matches.map(entry => <button type="button" key={labPlayerKey(entry)} disabled={busy} onClick={() => void load([{ player: entry, slot }])}>
          <span>{entry.player.name}</span><small>{entry.sport} · {entry.sport === 'NFL' ? entry.player.teamAbbr : entry.player.team.abbr} · {entry.player.position}</small></button>)}
        {!matches.length && <p>{loadingDirectory ? 'Refreshing verified players… Saved rosters remain searchable.' : 'No matching player. Try a first or last name, or refresh players.'}</p>}
      </div>}
    </div></header>
    {open && <div id="gamewire-bot-panel" className="gwb-panel">
      <div className="gwb-mode">Verified NFL + NBA data · Search-only player analysis · Experimental estimates</div>
      <div className="gwb-controls"><label>NFL scoring<select value={format} disabled={busy} onChange={event => {
        const scoring = event.target.value as BotFormat; setFormat(scoring);
        const entries = outlooks.flatMap((row, index) => row?.player.sport === 'NFL' ? [{ player: row.player, slot: index }] : []);
        if (entries.length) void load(entries, scoring);
      }}><option value="ppr">PPR</option><option value="half">Half PPR</option><option value="standard">Standard</option></select></label>
        <button type="button" disabled={busy || loadingDirectory} onClick={() => setRevision(value => value + 1)} aria-label="Refresh NFL and NBA player search"><RefreshCw size={17} />Refresh players</button>
        <button type="button" disabled={busy} aria-pressed={comparing} onClick={() => {
          setComparing(!comparing); setSlot(comparing ? 0 : outlooks[0] ? 1 : 0);
          if (comparing) setOutlooks(previous => [previous[0], null]); searchInput.current?.focus();
        }}><ArrowLeftRight size={17} />{comparing ? 'Exit Compare' : 'Compare'}</button>
        {outlooks.some(Boolean) && <button type="button" disabled={busy} onClick={() => void load(outlooks.flatMap((row, index) => row ? [{ player: row.player, slot: index }] : []))}>Refresh outlook</button>}
      </div>
      {comparing && <><h4>Compare Players</h4><p className="gwb-muted">Each player keeps their own sport and scoring context.</p>
        <div className="gwb-compare-slots" aria-label="Choose comparison player">{outlooks.map((row, index) =>
          <button type="button" key={index} disabled={busy} aria-pressed={slot === index} onClick={() => { setSlot(index); searchInput.current?.focus(); }}>
            <small>Player {index + 1}</small><b>{row?.player.player.name ?? 'Choose a player'}</b><span>{slot === index ? 'Searching this slot' : 'Change player'}</span></button>)}</div></>}
      {loadingDirectory && <p role="status">Refreshing NFL and NBA rosters · {players.length} saved players searchable.</p>}
      {issues.map((issue, index) => <p key={index} className="gwb-warning">{issue}</p>)}
      {busy && <p className="gwb-loading" role="status">Checking player outlooks and saved matchup projections…</p>}
      {!outlooks.some(Boolean) && !busy && <div className="gwb-welcome"><Bot size={28} /><h4>Your player check-in.</h4>
        <p>Search an NFL or NBA player for identity, projected stats, recorded history and matchup details.</p></div>}
      <div className={comparing ? 'gwb-comparison' : undefined} aria-label={comparing ? 'Side-by-side player comparison' : 'Player outlook'}>
        {outlooks.slice(0, comparing ? 2 : 1).map((row, index) => <section key={index} aria-label={`Player ${index + 1} outlook`}>
          {row?.nfl && renderNFL(row.nfl, () => clear(index))}
          {row?.nba && <NBAPlayerCard report={row.nba} onClear={() => clear(index)} />}
          {row && !row.nfl && !row.nba && <div className="gwb-welcome"><h4>{row.player.player.name}</h4><p>{row.player.sport} · {row.player.player.position}</p>
            {row.error && <div role="alert" className="gwb-error"><p>{row.error}</p><button disabled={busy} onClick={() => void load([{ player: row.player, slot: index }])}>Retry</button></div>}</div>}
        </section>)}
      </div>
    </div>}
  </section>;
}
