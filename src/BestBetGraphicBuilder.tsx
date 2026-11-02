import { useEffect, useRef, useState } from 'react';
import { bestBetGraphicError, bestBetGraphicHeight, newBestBetEntry, newBestBetGraphic, readBestBetGraphic, renderBestBetGraphic } from './services/bestBetGraphic';
import type { BestBetEntry, BestBetGraphic } from './services/bestBetGraphic';
import BestBetSubjectPicker from './BestBetSubjectPicker';
import './parlayGraphic.css';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The Best Bet graphic could not be saved or exported. Retry.';
export default function BestBetGraphicBuilder({ userId }: { userId: string }) {
  const key = `gamewire:best-bet-draft:v1:${userId}`;
  const [initial] = useState(() => {
    try { const saved = localStorage.getItem(key); return { value: saved ? readBestBetGraphic(JSON.parse(saved)) : newBestBetGraphic(), error: '' }; }
    catch (cause) { return { value: newBestBetGraphic(), error: message(cause) }; }
  });
  const [value, setValue] = useState(initial.value), [storageError, setStorageError] = useState(initial.error);
  const [blocked, setBlocked] = useState(!!initial.error), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState(''), [reset, setReset] = useState(false);
  const url = useRef('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (url.current) URL.revokeObjectURL(url.current); }; }, []);
  const save = (next: BestBetGraphic) => {
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(''); }
    catch (cause) { setStorageError(`Draft not saved on this device: ${message(cause)}`); }
  };
  const update = (next: BestBetGraphic) => { setValue(next); save(next); setPreview(''); setError(''); };
  const edit = (id: string, patch: Partial<BestBetEntry>) => update({ ...value, entries: value.entries.map(row => row.id === id ? { ...row, ...patch } : row) });
  const download = async () => {
    setBusy(true); setError('');
    try {
      const blob = await renderBestBetGraphic(value);
      if (!mounted.current) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob); setPreview(url.current);
      const link = document.createElement('a'); link.href = url.current; link.download = 'GameWire-Analyst-Desk-Best-Bets.png'; link.click();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  return <details className="best-bet-studio"><summary>Best Bet graphic studio</summary>
    <section className="parlay-builder" aria-label="Best Bet graphic builder">
      <header><span className="eyebrow">ANALYST DESK / GRAPHIC STUDIO</span><h3>Build your Best Bets</h3>
        <p>One to eight independent straight bets from any sport. Manual selections and optional odds, not live quotes. Saved locally per account on this device. Downloading does not publish or change your results record.</p></header>
      {storageError && <p role="alert" className="feed-warning">{storageError}
        {!blocked && <button type="button" onClick={() => save(value)}>Retry draft save</button>}</p>}
      <fieldset disabled={busy || blocked}><legend>Graphic details</legend><div className="parlay-fields">
        <label>Title<input maxLength={48} value={value.title} onChange={event => update({ ...value, title: event.target.value })} /></label>
        <label>Slate / date / time (optional)<input maxLength={100} placeholder="NFL Week 9 / Sunday / 1 PM ET" value={value.subtitle} onChange={event => update({ ...value, subtitle: event.target.value })} /></label>
      </div>
      <label className="parlay-checkbox"><input type="checkbox" checked={value.images !== false} onChange={event => update({ ...value, images: event.target.checked })} />Include selected player faces and team logos</label>
      <small>Choose images per straight below. Turn off images for a text-only export without portrait requests.</small>
      {value.entries.map((row, index) => <fieldset key={row.id}><legend>Straight bet {index + 1}</legend>
        <BestBetSubjectPicker sport={row.sport} value={row.participant} onChoose={(sport, participant) => edit(row.id, { ...(participant ? { sport } : {}), participant })}>
        <div className="parlay-fields">
        <label>Sport<input maxLength={20} placeholder="NFL, NBA, NHL..." value={row.sport} onChange={event => edit(row.id, { sport: event.target.value, participant: undefined })} /></label>
        <label>American odds (optional)<input maxLength={12} placeholder="-110" value={row.odds} onChange={event => edit(row.id, { odds: event.target.value })} /></label>
        <label className="parlay-wide">{row.participant ? `Bet for ${row.participant.subject.name}` : 'Bet / selection'}<textarea maxLength={200}
          placeholder={row.participant ? 'Over 60.5 receiving yards / Moneyline / Spread -3.5' : 'Player / team, side, exact line and stat'}
          value={row.selection} onChange={event => edit(row.id, { selection: event.target.value })} /></label>
        <label>Result mark<select value={row.result} onChange={event => {
          const result = event.target.value;
          if (result === 'pending' || result === 'hit' || result === 'miss') edit(row.id, { result });
        }}><option value="pending">Pregame / no mark</option><option value="hit">Hit / green check</option><option value="miss">Miss / red X</option></select></label>
        <button type="button" disabled={value.entries.length === 1} onClick={() => update({ ...value, entries: value.entries.filter(entry => entry.id !== row.id) })}>Remove straight {index + 1}</button>
      </div></BestBetSubjectPicker></fieldset>)}
      <button type="button" disabled={value.entries.length >= 8} onClick={() => update({ ...value, entries: [...value.entries, newBestBetEntry()] })}>Add straight bet · {value.entries.length}/8</button>
      <p>{bestBetGraphicError(value) ?? 'Ready to download.'}</p>
      <button type="button" disabled={!!bestBetGraphicError(value)} onClick={() => void download()}>{busy ? 'Creating graphic...' : `Download Best Bet PNG · 2160 x ${bestBetGraphicHeight(value.entries.length) * 2}`}</button>
      </fieldset>
      {error && <p role="alert" className="feed-warning">{error}</p>}
      {preview && <div className="parlay-preview"><img src={preview} alt="Manually entered Analyst Desk Best Bet straight selections" /><a href={preview} download="GameWire-Analyst-Desk-Best-Bets.png">Save PNG again</a></div>}
      <button type="button" disabled={busy} onClick={() => setReset(true)}>Clear working template</button>
      {reset && <div><p>Discard this device's Best Bet draft and start a blank template?</p><button type="button" onClick={() => { setBlocked(false); update(newBestBetGraphic()); setReset(false); }}>Confirm clear template</button><button type="button" onClick={() => setReset(false)}>Keep draft</button></div>}
    </section>
  </details>;
}
