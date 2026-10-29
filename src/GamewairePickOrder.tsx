import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Candidate } from './services/gamewaire';
import { movePick, orderedTopPicks } from './services/gamewaireOrder';
import type { PickOrder } from './services/gamewaireOrder';
import { supabase } from './services/supabaseClient';

export default function GamewairePickOrder({ picks, order, date, refresh, onSave }: {
  picks: Candidate[]; order?: PickOrder; date: string; refresh: () => void; onSave: (order: PickOrder) => void;
}) {
  const [keys, setKeys] = useState(() => orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [revision, setRevision] = useState(order?.revision ?? 0);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  const beforeDrag = useRef<{ keys: string[]; dirty: boolean; notice: string; error: string }>({ keys: [], dirty: false, notice: '', error: '' });
  useEffect(() => {
    if (!dirty && (order?.revision ?? 0) >= revision) {
      setKeys(orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key));
      setRevision(order?.revision ?? 0);
    }
  }, [picks, order, dirty, revision]);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.querySelectorAll<HTMLLIElement>('li[data-pick-key]') ?? []) {
      const key = row.dataset.pickKey;
      if (!key) continue;
      const top = row.offsetTop;
      const previous = positions.current.get(key);
      if (previous !== undefined && previous !== top && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const child of row.children) {
          child.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
        }
      }
      next.set(key, top);
    }
    positions.current = next;
  }, [keys]);
  const move = (key: string, to: number) => {
    setKeys((current) => movePick(current, current.indexOf(key), to));
    setDirty(true); setNotice('Order changed. Save to update everyone’s view.'); setError('');
  };
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!supabase) throw new Error('Account services are not configured.');
      const { data, error: problem } = await supabase.rpc('gamewaire_save_pick_order', {
        target_date: date, ordered_keys: keys, expected_revision: revision,
      });
      if (problem) throw problem;
      if (!data || typeof data.revision !== 'number') throw new Error('The saved pick order could not be confirmed.');
      setRevision(data.revision); setDirty(false); setNotice('Order saved for everyone.');
      onSave({ game_date: date, pick_keys: keys, revision: data.revision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : typeof cause === 'object' && cause && 'message' in cause && typeof cause.message === 'string'
        ? cause.message : 'Could not save pick order. Your changes are still here.');
    } finally { setBusy(false); }
  };
  if (!picks.length) return <p className="gai-note">No published Top Picks to arrange for this date.</p>;
  return <section className="gai-order-editor" aria-label="Order published Top Picks">
    <h4>All published Top Picks · {date}</h4>
    <p className="gai-note">Drag the three-line handle to set everyone’s order across both sports for this date. Mobile shows 3; desktop shows 5. Use Up/Down arrow keys on a handle for keyboard ordering.</p>
    <ol ref={list} className={`gai-order-list${dragging ? ' is-sorting' : ''}`}
      onPointerMove={(event) => {
        if (!dragging) return;
        const rows = [...(list.current?.querySelectorAll<HTMLLIElement>('li[data-pick-key]') ?? [])];
        const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('li[data-pick-key]');
        const target = rows.findIndex((row) => row === hovered);
        if (target >= 0 && target !== keys.indexOf(dragging)) move(dragging, target);
        if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 12);
        else if (event.clientY < 100) window.scrollBy(0, -12);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => {
        setKeys(beforeDrag.current.keys); setDirty(beforeDrag.current.dirty);
        setNotice(beforeDrag.current.notice); setError(beforeDrag.current.error); setDragging(null);
      }}
      onLostPointerCapture={() => setDragging(null)}>{keys.map((key, index) => {
      const pick = picks.find((candidate) => candidate.key === key);
      if (!pick) return null;
      return <li key={key} data-pick-key={key} className={dragging === key ? 'is-dragging' : ''}>
        <span className="gai-order-number">{index + 1}</span>
        <div><b>{pick.subject} · {pick.market === 'h2h' ? 'ML' : `${pick.side} ${pick.line ?? ''}`}</b><small>{pick.sport} · {pick.away} @ {pick.home}</small></div>
        <button type="button" className="gai-order-handle" disabled={busy} aria-label={`Reorder ${pick.subject}, position ${index + 1} of ${keys.length}`}
          onKeyDown={(event) => {
            const to = event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'ArrowDown' ? Math.min(keys.length - 1, index + 1)
              : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null;
            if (to !== null) { event.preventDefault(); move(key, to); }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            beforeDrag.current = { keys, dirty, notice, error }; setDragging(key);
            list.current?.setPointerCapture(event.pointerId);
          }}>
          <span aria-hidden="true"><i /><i /><i /></span>
        </button>
      </li>;
    })}</ol>
    <div className="gai-order-actions"><button disabled={busy || !dirty || !!dragging} onClick={() => void save()}>{busy ? 'Saving…' : 'Save order · 0 credits'}</button>
      <button disabled={busy || !dirty || !!dragging} onClick={() => {
        setKeys(orderedTopPicks(picks, order ? [order] : []).map((pick) => pick.key)); setDirty(false); setError(''); setNotice('');
      }}>Discard changes</button></div>
    {notice && <p role="status" className="gai-note">{notice}</p>}
    {error && <p role="alert" className="feed-warning">{error} <button disabled={busy} onClick={() => {
      setDirty(false); setRevision(order?.revision ?? 0); setError(''); refresh();
    }}>Reload published order</button></p>}
  </section>;
}
