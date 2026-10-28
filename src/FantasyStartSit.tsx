import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Download, Plus, RefreshCw } from 'lucide-react';
import type { Game } from './services/sportsData';
import { supabase } from './services/supabaseClient';
import { emptyFantasyGraphic, fantasyGraphicPublishError, graphicPositionLabels, graphicPositions, readFantasyGraphicRows } from './services/fantasyGraphics';
import type { FantasyGraphic, FantasyGraphicRow, GraphicPlayer } from './services/fantasyGraphics';
import { renderFantasyGraphic } from './services/fantasyGraphicImage';
import { fetchFantasyGraphicRoster } from './services/fantasyGraphicRoster';
import { clearFantasyGraphicDraft, loadFantasyGraphicDraft, saveFantasyGraphicDraft } from './services/fantasyGraphicDrafts';
import type { FantasyGraphicDraft } from './services/fantasyGraphicDrafts';
import XPublishingStatus from './XPublishingStatus';
import { useOnlineStatus } from './OfflineStatus';
import './fantasyStartSit.css';

const message = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
  ? cause.message : 'The Start/Sit request failed. Please retry.';
type Props = { active: boolean; season: number | null; week: number | null; games: Game[]; user: User | null };

function GraphicPreview({ graphic, onDownload = false }: { graphic: FantasyGraphic; onDownload?: boolean }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const renderedUrl = useRef('');
  useEffect(() => () => { if (renderedUrl.current) URL.revokeObjectURL(renderedUrl.current); }, []);
  useEffect(() => {
    let current = true;
    setReady(false); setError('');
    const timer = window.setTimeout(() => {
      void renderFantasyGraphic(graphic, onDownload).then((blob) => {
        if (!current) return;
        const previous = renderedUrl.current;
        const next = URL.createObjectURL(blob);
        renderedUrl.current = next; setUrl(next); setReady(true);
        if (previous) URL.revokeObjectURL(previous);
      }).catch((cause: unknown) => { if (current) setError(message(cause)); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [graphic, retry, onDownload]);
  return <div className="fantasy-graphic-preview">
    {error ? <p role="alert">{error} {url && 'Showing the last rendered preview; your edits are still kept.'} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button></p>
      : !ready && <p role="status">{url ? 'Updating preview...' : 'Rendering graphic...'}</p>}
    {url && <img src={url} width={1080} height={1350} alt={ready ? `GameWire Must ${graphic.kind === 'start' ? 'Start' : 'Sit'} ${graphicPositionLabels[graphic.position]} graphic` : 'Last rendered Start/Sit graphic preview (not up to date)'} />}
    {onDownload && ready && <a className="angle-create-button" href={url} download={`GameWire-Must-${graphic.kind}-${graphic.position}.png`}><Download size={16} aria-hidden="true" />Download PNG · 2160 × 2700</a>}
  </div>;
}

export default function FantasyStartSit({ active, season: feedSeason, week: feedWeek, games, user }: Props) {
  const online = useOnlineStatus();
  const lastWeek = useRef<{ userId: string; season: number; week: number } | null>(null);
  if (user && feedSeason && feedWeek) lastWeek.current = { userId: user.id, season: feedSeason, week: feedWeek };
  const previousWeek = lastWeek.current?.userId === user?.id ? lastWeek.current : null;
  const season = feedWeek ? feedSeason : previousWeek?.season ?? feedSeason;
  const week = feedWeek ?? previousWeek?.week ?? null;
  const [admin, setAdmin] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [rows, setRows] = useState<FantasyGraphicRow[]>([]);
  const [form, setForm] = useState<FantasyGraphic | null>(null);
  const [editing, setEditing] = useState<FantasyGraphicRow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [players, setPlayers] = useState<GraphicPlayer[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [rosterRetry, setRosterRetry] = useState(0);
  const [queries, setQueries] = useState(['', '', '', '']);
  const [draftError, setDraftError] = useState('');
  const [postToX, setPostToX] = useState(false);
  const restoreFailed = useRef(false);
  const retainedDrafts = useRef(new Map<string, FantasyGraphicDraft>());
  const editor = useRef<HTMLFormElement>(null);
  const scope = `${user?.id ?? 'guest'}:${season}:${week}`;
  const formScope = useRef(scope);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const scheduleKey = games.filter((game) => game.league === 'NFL').map((game) => `${game.id}:${game.home.id}:${game.away.id}`).sort().join('|');
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const activeForm = formScope.current === scope ? form : null;

  useEffect(() => {
    setAdmin(false); setAccessReady(false); setAccessError('');
  }, [user?.id]);
  useEffect(() => {
    let current = true;
    if (!user || !supabase || !online) { setAccessReady(true); return; }
    void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', user.id).maybeSingle()).then(({ data, error: cause }) => {
      if (cause) throw cause;
      if (current) {
        const allowed = data?.role === 'admin' || data?.role === 'owner';
        setAdmin(allowed); setAccessReady(true); setAccessError('');
      }
    }).catch((cause: unknown) => {
      if (current) { setAccessReady(true); setAccessError(`Could not refresh Start/Sit access: ${message(cause)} Your working graphic stays open. Retry when the connection improves.`); }
    });
    return () => { current = false; };
  }, [user?.id, refresh, online]);

  useEffect(() => {
    if (!active || !online || !accessReady || !season || !week) { setLoading(false); return; }
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    if (!supabase) { setError('Account services are not configured.'); setLoading(false); return; }
    void Promise.resolve(supabase.rpc('list_fantasy_graphics', { graphic_season: season, graphic_week: week }).abortSignal(controller.signal))
      .then(({ data, error: cause }) => {
        if (cause) throw cause;
        const next = readFantasyGraphicRows(data);
        if (current) { setRows(next); setError(''); }
      }).catch((cause: unknown) => { if (current) setError(`Could not load Start/Sit graphics: ${message(cause)}`); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [active, online, accessReady, admin, season, week, user?.id, refresh]);

  useEffect(() => {
    setRows([]); setNotice(''); setPlayers([]);
  }, [scope]);
  useEffect(() => {
    restoreDraft();
  }, [scope]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!active || !online || !activeForm || !season) { setRosterLoading(false); return; }
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    setRosterLoading(true); setRosterError('');
    void fetchFantasyGraphicRoster(season, games, controller.signal).then((result) => {
      if (current) { setPlayers(result.players); setRosterError(result.warning); }
    }).catch((cause: unknown) => { if (current) setRosterError(message(cause)); })
      .finally(() => { if (current) setRosterLoading(false); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [active, online, !!activeForm, season, scheduleKey, rosterRetry]);

  function restoreDraft() {
    formScope.current = scope;
    setForm(null); setEditing(null); setDirty(false); setQueries(['', '', '', '']); setPostToX(false);
    setDraftError(''); restoreFailed.current = false;
    if (!user || !season || !week) return;
    try {
      const draft = retainedDrafts.current.get(scope) ?? loadFantasyGraphicDraft(user.id, season, week);
      if (!draft) return;
      setForm(draft.form); setEditing(draft.editing); setDirty(draft.dirty); setQueries(draft.queries);
      setPostToX(draft.postToX ?? false);
      persistDraft(draft);
      setNotice('Your on-device Start/Sit draft was restored. Save shared draft to share it with other admins.');
    } catch (cause) {
      restoreFailed.current = true;
      setDraftError(`Could not restore your on-device draft: ${message(cause)}`);
    }
  }
  function persistDraft(draft: FantasyGraphicDraft) {
    if (!user || !season || !week) return;
    retainedDrafts.current.set(scope, draft);
    try {
      saveFantasyGraphicDraft(user.id, season, week, draft);
      setDraftError(''); restoreFailed.current = false;
    } catch (cause) {
      setDraftError(`On-device draft saving failed: ${message(cause)} Keep this editor open and save a shared draft to protect your work.`);
    }
  }
  function open(row?: FantasyGraphicRow) {
    if (dirtyRef.current && !window.confirm('Replace your unsaved graphic changes? Save the draft first to keep them.')) return;
    if (restoreFailed.current && !window.confirm('Your on-device draft could not be restored. Replace it with this graphic?')) return;
    const next = row?.content ?? emptyFantasyGraphic();
    const nextQueries = ['', '', '', ''];
    setForm(next); setEditing(row ?? null); setDirty(false); setPostToX(false);
    setQueries(nextQueries); setNotice(''); setError(''); formScope.current = scope;
    persistDraft({ form: next, editing: row ?? null, dirty: false, queries: nextQueries });
    window.setTimeout(() => editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  function change(next: FantasyGraphic, nextQueries = queries) {
    setForm(next); setDirty(true); setQueries(nextQueries); setNotice('');
    persistDraft({ form: next, editing, dirty: true, queries: nextQueries, postToX });
  }
  function changeQuery(index: number, query: string) {
    const nextQueries = queries.map((value, i) => i === index ? query : value);
    setQueries(nextQueries);
    if (activeForm) persistDraft({ form: activeForm, editing, dirty, queries: nextQueries, postToX });
  }
  function closeEditor() {
    if (dirty && !window.confirm('Discard unsaved changes? The saved shared draft is unchanged.')) return;
    try {
      if (user && season && week) clearFantasyGraphicDraft(user.id, season, week);
    } catch (cause) {
      setDraftError(`Could not clear your on-device draft: ${message(cause)} The editor was kept open. Please retry.`);
      return;
    }
    retainedDrafts.current.delete(scope);
    setForm(null); setEditing(null); setDirty(false); setDraftError(''); setNotice('');
  }
  async function save(action: 'draft' | 'publish' | 'unpublish') {
    if (!supabase || !user || !activeForm || !admin || !season || !week || busy) return;
    if (!online) { setError('Connection unavailable. Your graphic stays open and your edits are kept. Reconnect to save a shared draft or publish.'); return; }
    const savedScope = scope;
    setBusy(true); setError(''); setNotice('');
    let uploadedPath: string | null = null;
    try {
      if (action === 'publish') {
        const validation = fantasyGraphicPublishError(activeForm);
        if (validation) throw new Error(validation);
        const png = await renderFantasyGraphic(activeForm, true);
        if (png.size > 5 * 1024 * 1024) throw new Error('The graphic exceeds the 5 MB photo limit. Shorten the content or retry rendering.');
        const path = `${user.id}/${crypto.randomUUID()}.png`;
        const uploaded = await supabase.storage.from('livewire-photos').upload(path, png, { contentType: 'image/png', upsert: false });
        if (uploaded.error) throw uploaded.error;
        uploadedPath = path;
      }
      const result = await supabase.rpc('save_fantasy_graphic_publication', {
        graphic_id: editing?.id ?? null, graphic_season: season, graphic_week: week, graphic_content: activeForm,
        expected_revision: editing?.revision ?? 0, graphic_action: action,
        graphic_image_path: uploadedPath, post_to_x: postToX,
      });
      if (result.error) {
        // Cleanup only a confirmed RPC rejection; an interrupted response may have committed.
        if (uploadedPath && result.error.code) {
          const cleanup = await supabase.storage.from('livewire-photos').remove([uploadedPath]);
          if (cleanup.error) throw new Error(`${message(result.error)} Unused graphic cleanup also failed: ${cleanup.error.message}`);
        }
        throw result.error;
      }
      const [row] = readFantasyGraphicRows(result.data);
      if (!row) throw new Error('The saved graphic was not returned. Reload before trying again.');
      // Keep the completed save's revision even if the user changed weeks while it was in flight.
      const savedDraft = action === 'publish'
        ? { form: emptyFantasyGraphic(), editing: null, dirty: false, queries: ['', '', '', ''], postToX: false }
        : { form: activeForm, editing: row, dirty: false, queries, postToX };
      retainedDrafts.current.set(savedScope, savedDraft);
      try {
        saveFantasyGraphicDraft(user.id, season, week, savedDraft);
        if (currentScope.current === savedScope) setDraftError('');
      } catch (cause) {
        if (currentScope.current === savedScope) setDraftError(`The shared graphic was saved, but on-device draft saving failed: ${message(cause)}`);
        else console.error('Could not update the saved Start/Sit draft on this device', cause);
      }
      const nextRows = [row, ...rows.filter((item) => item.id !== row.id)];
      if (currentScope.current !== savedScope || formScope.current !== savedScope) return;
      setForm(savedDraft.form); setEditing(savedDraft.editing); setDirty(false); setQueries(savedDraft.queries); setPostToX(savedDraft.postToX);
      setRows(nextRows);
      setNotice(action === 'publish' ? `Graphic published in Start/Sit and The Angle. The working template is cleared for your next graphic.${postToX ? ' Check X publishing status below for delivery; only first publications are eligible.' : ''}` : action === 'unpublish' ? 'Graphic removed from Start/Sit and The Angle. The shared draft is still available to admins. Any tweet already sent is unchanged.' : 'Shared draft saved. All admins can continue editing it.');
    } catch (cause) {
      if (formScope.current === savedScope) setError(message(cause));
    }
    finally { setBusy(false); }
  }
  const published = rows.filter((row) => row.published_content);
  return <section className="fantasy-start-sit" hidden={!active} aria-label="Fantasy Start/Sit">
    <div className="fantasy-graphic-heading"><div><h2>Fantasy Start/Sit</h2><p>GameWire admin opinions · {season ?? '—'} · Week {week ?? '—'}</p></div>
      <div className="angle-actions">
        {admin && <button type="button" className="angle-create-button" disabled={busy || !season || !week} onClick={() => open()}><Plus size={16} aria-hidden="true" />Create graphic</button>}
        <button type="button" className="angle-create-button" disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" />Refresh graphics</button>
      </div>
    </div>
    {error && <p className="feed-warning" role="alert">{error}</p>}
    {accessError && <p className="feed-warning" role="status">{accessError}</p>}
    {!online && activeForm && <p role="status">Connection interrupted. Your graphic stays open and your edits are kept. Saving shared drafts and publishing will be available when you reconnect.</p>}
    {(admin || activeForm) && draftError && <p className="feed-warning" role="alert">{draftError} <button type="button" disabled={busy} onClick={() => {
      if (activeForm) persistDraft({ form: activeForm, editing, dirty, queries, postToX });
      else restoreDraft();
    }}>Retry on-device draft</button></p>}
    {notice && <p role="status">{notice}</p>}
    {activeForm && <form ref={editor} className="fantasy-graphic-editor" aria-label="Start/Sit graphic editor" onSubmit={(event) => { event.preventDefault(); void save('publish'); }}>
      <h3>{editing ? 'Edit shared graphic' : 'Create Start/Sit graphic'}</h3>
      <p>{draftError ? 'On-device recovery is not up to date. Save a shared draft to protect your work.' : 'Changes are saved automatically on this device for this account and week.'} {dirty ? 'Not yet saved to the shared draft.' : editing ? 'Published artwork stays unchanged until you publish again.' : 'Choose four players and write your take.'} Save shared draft to share your work with other admins.</p>
      <fieldset disabled={busy} className="fantasy-graphic-controls">
        <label>Graphic type<select aria-label="Graphic type" value={activeForm.kind} onChange={(event) => change({ ...activeForm, kind: event.target.value === 'sit' ? 'sit' : 'start' })}><option value="start">Must Start</option><option value="sit">Must Sit</option></select></label>
        <label>Position<select aria-label="Position" value={activeForm.position} onChange={(event) => {
          const position = graphicPositions.find((value) => value === event.target.value);
          if (!position || position === activeForm.position) return;
          if (activeForm.slots.some((slot) => slot.player || slot.reason) && !window.confirm('Changing position clears the four player slots and reasoning. Continue?')) return;
          change({ ...emptyFantasyGraphic(), kind: activeForm.kind, position }, ['', '', '', '']);
        }}>{graphicPositions.map((position) => <option key={position} value={position}>{position}</option>)}</select></label>
      </fieldset>
      <p>Search active skill-player rosters. Matchups come from the selected week's schedule; unavailable opponents show TBD, not an invented matchup. Verify injuries, opponents, and claims before publishing.</p>
      {rosterLoading && <p role="status">Loading player search...</p>}
      {rosterError && <p className="feed-warning" role="alert">{rosterError} <button type="button" onClick={() => setRosterRetry((value) => value + 1)}>Retry player search</button></p>}
      <fieldset disabled={busy} className="fantasy-graphic-slots">
        {activeForm.slots.map((slot, index) => {
          const query = queries[index].trim().toLocaleLowerCase();
          const matches = query.length >= 2 ? players.filter((player) => player.position === activeForm.position && player.name.toLocaleLowerCase().includes(query)).slice(0, 12) : [];
          return <div className="fantasy-graphic-slot" key={index}>
            <div className="fantasy-graphic-identity">
              <label>Player {index + 1} search<input type="search" autoComplete="off" placeholder={`Search ${activeForm.position} name`} value={queries[index]} onChange={(event) => changeQuery(index, event.target.value)} /></label>
              {query.length >= 2 && <ul className="fantasy-graphic-search" aria-label={`Player ${index + 1} results`}>
                {matches.map((player) => <li key={player.id}><button type="button" disabled={activeForm.slots.some((item, i) => i !== index && item.player?.id === player.id)} onClick={() => {
                  change({ ...activeForm, slots: activeForm.slots.map((item, i) => i === index ? { ...item, player } : item) },
                    queries.map((value, i) => i === index ? '' : value));
                }}>{player.name} · {player.teamAbbr}</button></li>)}
                {!matches.length && !rosterLoading && <li>No matching {activeForm.position} players.</li>}
              </ul>}
              {slot.player ? <><img className="fantasy-graphic-headshot" src={slot.player.headshot || undefined} alt={slot.player.name} /><strong>{slot.player.name}</strong>
                <div className="fantasy-graphic-opponent"><span>{slot.player.matchup}</span>{slot.player.opponentLogo && <img src={slot.player.opponentLogo} alt="" />}<span>{slot.player.opponent}</span></div>
                <button type="button" onClick={() => change({ ...activeForm, slots: activeForm.slots.map((item, i) => i === index ? { ...item, player: null } : item) })}>Clear player {index + 1}</button>
              </> : <p>Choose a player to add their face, name, and matchup.</p>}
            </div>
            <label className="fantasy-graphic-reason"><span id={`graphic-reason-${index}`}>The GameWire Take · Player {index + 1}</span><textarea aria-labelledby={`graphic-reason-${index}`} aria-describedby={`graphic-reason-help-${index}`} maxLength={650} rows={5} placeholder="Write your reasoning..." value={slot.reason} onChange={(event) => change({ ...activeForm, slots: activeForm.slots.map((item, i) => i === index ? { ...item, reason: event.target.value } : item) })} /><small id={`graphic-reason-help-${index}`}>{slot.reason.length}/650 · Must fit six lines in the preview</small></label>
          </div>;
        })}
      </fieldset>
      <h3>Graphic preview</h3>
      <GraphicPreview graphic={activeForm} />
      <label className="x-publishing-choice"><input type="checkbox" checked={postToX} disabled={busy} onChange={(event) => {
        setPostToX(event.target.checked);
        persistDraft({ form: activeForm, editing, dirty, queries, postToX: event.target.checked });
      }} />Post to X on first publication</label>
      <p>Publishing also posts the subject and graphic in The Angle. Checked X posts use the exact same subject and PNG, without extra wording or a link. Edits and republishing do not send another tweet.</p>
      <div className="angle-actions">
        <button type="button" disabled={busy || !online || !admin} onClick={() => void save('draft')}>Save shared draft</button>
        <button type="submit" disabled={busy || !online || !admin}>{busy ? 'Saving...' : 'Publish graphic'}</button>
        {editing?.published_content && <button type="button" disabled={busy || !online || !admin} onClick={() => { if (window.confirm('Remove this graphic from the public Start/Sit gallery?')) void save('unpublish'); }}>Unpublish graphic</button>}
        <button type="button" disabled={busy} onClick={closeEditor}>Close editor</button>
      </div>
      {!fantasyGraphicPublishError(activeForm) && <GraphicDownload graphic={activeForm} />}
    </form>}
    {admin && active && online && <XPublishingStatus />}
    {admin && <section aria-label="Shared Start/Sit drafts" className="fantasy-graphic-drafts"><h3>Shared admin drafts</h3>
      <p>All admins can edit these graphics. Saving a draft does not replace the published version.</p>
      {rows.map((row) => <button type="button" key={row.id} disabled={busy} onClick={() => open(row)}>
        Must {row.content.kind === 'start' ? 'Start' : 'Sit'} · {row.content.position} · {row.content.slots.map((slot) => slot.player?.name).filter(Boolean).join(', ') || 'Empty draft'}
        <small>{row.published_content ? 'Published + shared draft' : 'Draft only'} · revision {row.revision}</small>
      </button>)}
      {!rows.length && !loading && <p>No shared drafts for this week yet.</p>}
    </section>}
    <section aria-label="Published Start/Sit graphics" className="fantasy-graphic-gallery">
      <h3>Published graphics</h3>
      {loading && <p role="status">Loading Start/Sit graphics...</p>}
      {!published.length && !loading && <p>No Start/Sit graphics have been published for this week.</p>}
      {published.map((row) => row.published_content && <article key={row.id}>
        <h4>Must {row.published_content.kind === 'start' ? 'Start' : 'Sit'} · {graphicPositionLabels[row.published_content.position]}</h4>
        <GraphicPreview graphic={row.published_content} onDownload />
        <details><summary>Read player analysis</summary>{row.published_content.slots.map((slot, index) => <div key={index}><h4>{slot.player?.name} · {slot.player?.matchup} {slot.player?.opponent}</h4><p>{slot.reason}</p></div>)}</details>
      </article>)}
    </section>
  </section>;
}

function GraphicDownload({ graphic }: { graphic: FantasyGraphic }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="fantasy-graphic-download"><button type="button" disabled={busy} onClick={() => {
    setBusy(true); setError('');
    void renderFantasyGraphic(graphic, true).then((blob) => {
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `GameWire-Must-${graphic.kind}-${graphic.position}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }).catch((cause: unknown) => setError(message(cause))).finally(() => setBusy(false));
  }}><Download size={16} aria-hidden="true" />{busy ? 'Preparing PNG...' : 'Download PNG · 2160 × 2700'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
