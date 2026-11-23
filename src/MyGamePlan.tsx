import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadResearch, removeResearch, saveResearch, updateResearch } from './services/research';
import type { ResearchSection, ResearchSnapshot, SavedResearch } from './services/research';
import { checkResearchResult } from './services/researchResults';
import './my-game-plan.css';

const ResearchContext = createContext({ scope: 'guest', onOpen: () => {} });
export function ResearchProvider({ scope, onOpen, children }: { scope: string; onOpen: () => void; children: ReactNode }) {
  return <ResearchContext.Provider value={{ scope, onOpen }}>{children}</ResearchContext.Provider>;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Device storage is unavailable. Retry saving before leaving this screen.';
const stamp = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString() : 'Unavailable';

export function SaveResearchButton({ capture }: { capture: () => ResearchSnapshot }) {
  const { scope, onOpen } = useContext(ResearchContext);
  const [open, setOpen] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const id = useId();
  async function save() {
    setBusy(true); setError('');
    try { await saveResearch(scope, capture(), note); setSaved(true); setOpen(false); setNote(''); }
    catch (cause) { console.error('Research snapshot save failed', cause); setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <div className="research-save">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); setSaved(false); }}>Save to My Game Plan</button>
    {open && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor={id}>What are you watching for? <span>(optional note)</span></label>
      <textarea id={id} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} disabled={busy} />
      <p>The displayed research is frozen when you save. Later refreshes will not replace it.</p>
      <div className="research-actions"><button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save on this device'}</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Cancel</button></div>
    </form>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Saved on this device. <button type="button" onClick={onOpen}>Open My Game Plan</button></p>}
  </div>;
}

function Sections({ sections }: { sections: ResearchSection[] }) {
  return <>{sections.map((section, index) => <section className="research-section" key={index}><h4>{section.title}</h4>
    {section.text && <p>{section.text}</p>}
    {!!section.rows.length && <dl>{section.rows.map((row, rowIndex) => <div key={rowIndex}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
  </section>)}</>;
}
function ResearchCard({ row, onChange }: { row: SavedResearch; onChange: (rows: SavedResearch[]) => void }) {
  const { scope } = useContext(ResearchContext);
  const [note, setNote] = useState(row.note), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false), [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const noteId = useId(), { snapshot } = row, game = snapshot.game;
  useEffect(() => () => request.current?.abort(), []);
  async function run(action: 'note' | 'result' | 'remove') {
    setBusy(true); setError(''); setNotice('');
    const controller = new AbortController();
    request.current = controller;
    try {
      if (action === 'result') {
        const result = await checkResearchResult(snapshot, controller.signal);
        controller.signal.throwIfAborted();
        onChange(await updateResearch(scope, row.id, { result }));
        setNotice('Verified final saved for offline review. Your original research has not changed.');
      } else if (action === 'note') {
        onChange(await updateResearch(scope, row.id, { note }));
        setNotice('Note saved on this device.');
      } else onChange(await removeResearch(scope, row.id));
    } catch (cause) {
      if (controller.signal.aborted) return;
      console.error('Research workspace action failed', cause); setError(message(cause));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <details className="research-card">
    <summary><span className="research-kicker">{snapshot.league} / {snapshot.kind === 'player' ? 'PLAYER' : 'MATCHUP'}</span>
      <strong>{snapshot.title}</strong><span>{game ? `${game.away} at ${game.home}` : 'No verified matchup'}{row.result ? ' / FINAL SAVED' : ''}</span>
      <small>Saved {stamp(row.savedAt)}</small></summary>
    <div className="research-card-body">
      {game && <p>Game time: {stamp(game.kickoff)}</p>}
      <div className="research-comparison">
        <section aria-label="Original saved research"><h3>Original research</h3>
          <p>Forecast time: {snapshot.forecastAt ? stamp(snapshot.forecastAt) : 'Not supplied by this report'}</p>
          <p className="research-identity">{snapshot.identity}</p><Sections sections={snapshot.sections} /></section>
        <section aria-label="Verified recorded results"><h3>After the game</h3>
          {row.result ? <><p>Verified {stamp(row.result.checkedAt)}</p><Sections sections={row.result.sections} /></>
            : <p>No final saved yet. Check after the game to compare recorded results with your unchanged research.</p>}
          {game && <button type="button" disabled={busy} onClick={() => void run('result')}>{busy ? 'Working...' : row.result ? 'Refresh verified final' : 'Check final result'}</button>}
        </section>
      </div>
      <label htmlFor={noteId}>Your research notes</label>
      <textarea id={noteId} maxLength={4000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
      <div className="research-actions"><button type="button" disabled={busy || note === row.note} onClick={() => void run('note')}>Save note</button>
        {note !== row.note && <span>Unsaved changes</span>}
        <button type="button" disabled={busy} onClick={() => setConfirm(!confirm)}>Remove saved item</button></div>
      {confirm && <div className="research-actions"><span>Remove this research and its notes from this device?</span>
        <button type="button" disabled={busy} onClick={() => void run('remove')}>Yes, remove</button>
        <button type="button" onClick={() => setConfirm(false)}>Keep item</button></div>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

export function ResearchGuide({ onFind }: { onFind: () => void }) {
  const { scope, onOpen } = useContext(ResearchContext), key = `gamewire-research-guide-v1:${scope}`;
  const [state, setState] = useState(() => {
    try { return { open: localStorage.getItem(key) !== 'done', error: '' }; }
    catch (cause) { console.error('Research guide preference could not load', cause); return { open: true, error: 'Guide preferences cannot be saved on this device.' }; }
  });
  function dismiss() {
    try { localStorage.setItem(key, 'done'); setState({ open: false, error: '' }); }
    catch (cause) { console.error('Research guide preference could not save', cause); setState({ open: false, error: 'Your guide preference could not be saved.' }); }
  }
  return <aside className={`research-guide${state.open ? '' : ' research-guide-collapsed'}`} aria-label="GameWire research guide">
    {state.open ? <><div><span className="research-kicker">YOUR GAME, BEFORE AND AFTER</span><h2>Build your own Game Plan</h2>
      <ol><li><b>Explore.</b> Search an NFL or NBA player in GamewAIre, or open a matchup simulation.</li>
        <li><b>Save your reasoning.</b> Save the displayed research with a personal note.</li>
        <li><b>Come back.</b> Open Locker Room, then My Game Plan. Reopen saved research offline; reconnect after the game to save verified finals alongside the original.</li></ol></div>
      <div className="research-actions"><button type="button" onClick={() => { dismiss(); onFind(); }}>Find a player</button>
        <button type="button" onClick={() => { dismiss(); onOpen(); }}>My Game Plan</button><button type="button" onClick={dismiss}>Not now</button></div></>
      : <><span>Research, save, revisit.</span><button type="button" onClick={onOpen}>My Game Plan</button>
        <button type="button" onClick={() => setState({ open: true, error: '' })}>How it works</button></>}
    {state.error && <p role="alert">{state.error}</p>}
  </aside>;
}

export default function MyGamePlan({ onFind }: { onFind: () => void }) {
  const { scope } = useContext(ResearchContext);
  const [rows, setRows] = useState<SavedResearch[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void loadResearch(scope).then(saved => { if (active) setRows(saved); }).catch(cause => {
      console.error('Saved research could not load', cause); if (active) setError(message(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, retry]);
  const visible = rows.filter(row => (filter === 'all' || row.snapshot.league === filter)
    && `${row.snapshot.title} ${row.snapshot.game?.home ?? ''} ${row.snapshot.game?.away ?? ''} ${row.note}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="my-game-plan" aria-labelledby="my-game-plan-heading">
    <header><span className="research-kicker">PERSONAL RESEARCH WORKSPACE</span><h2 id="my-game-plan-heading">My Game Plan</h2>
      <p>Keep the original forecast, write down your reasoning, and revisit what actually happened.</p></header>
    <p className="research-storage-note">Stored only on this device, separately for each account and guest mode. Saved research, notes, and checked finals open offline after the app has loaded. New data needs internet. Storage can be cleared or evicted; this is not a permanent backup.</p>
    <div className="research-tools"><label>Search research<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Player, matchup, or note" /></label>
      <label>Sport<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">NFL + NBA</option><option>NFL</option><option>NBA</option></select></label>
      <button type="button" onClick={onFind}>Find player research</button></div>
    {loading && <p role="status">Opening saved research...</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
    {!loading && !error && !rows.length && <div className="research-empty"><h3>Your next game starts here</h3>
      <p>Open a GamewAIre player card or an NFL/NBA matchup simulation and choose “Save to My Game Plan.” Add a question to follow up after the game.</p></div>}
    {!loading && !error && !!rows.length && <p role="status">{visible.length} of {rows.length} saved items</p>}
    {visible.map(row => <ResearchCard key={row.id} row={row} onChange={setRows} />)}
    {!loading && !error && !!rows.length && !visible.length && <p>No saved research matches this search.</p>}
  </section>;
}
