import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { BookOpen, ExternalLink, Plus } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { angleLeadGroup, angleLeadGroups, anglePicks, anglePublishError, angleSport, angleSportGameId, angleSports, angleSection, angleThemes, angleVisibleInWeek, angleWriteFields, isAngleSource, newsTypes, readAngles, selectAngleSuggestions } from './services/theAngle';
import type { Angle, AngleSection, AngleSuggestion, NewsType } from './services/theAngle';
import { fetchFavoriteNews } from './services/sportsData';
import { fetchBirthdaySuggestions } from './services/angleBirthdays';
import { fetchMatchupHistorySuggestions } from './services/angleHistory';
import type { Game } from './services/sportsData';
import { useAnalystReadObserver } from './useAnalystReadObserver';
import type { AnalystSeen } from './useAnalystReadObserver';
import { observePostViews } from './services/livewireViews';
import PostGallery, { postPhotoUrl } from './PostGallery';
import OfflineImage from './OfflineImage';
import AnglePicks from './AnglePicks';
import { pickCategories, pickCategory, pickCategoryLabels } from './services/anglePicks';
import XPublishingStatus from './XPublishingStatus';
import { loadAngleDraft, saveAngleDraft } from './services/angleDrafts';
import { postThemes } from './services/postThemes';

type Props = { games: Game[]; season: number | null; week: number | null; user: User | null; storyId?: string | null; storyOpenKey?: number; onSeen?: AnalystSeen; section?: AngleSection; onOpenSection?: (section: AngleSection) => void; active?: boolean };
const errorMessage = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
  ? cause.message : 'The Angle request failed. Please retry.';

async function fetchAngleSuggestions(games: Game[], signal: AbortSignal) {
  const birthdayRequest = fetchBirthdaySuggestions(games, signal);
  const historyRequest = fetchMatchupHistorySuggestions(games, signal);
  const suggestions: AngleSuggestion[] = [];
  const errors: string[] = [];
  for (let start = 0; start < games.length; start += 4) {
    await Promise.all(games.slice(start, start + 4).map(async (game) => {
      try {
        const articles = await fetchFavoriteNews([game.away, game.home].map((team) => ({
          key: `team:${game.feedPath}:${team.id}`, type: 'team', id: team.id,
          name: team.name, shortName: team.abbr, feedPath: game.feedPath,
        })), signal, true);
        if (!signal.aborted) suggestions.push(...selectAngleSuggestions(game, articles));
      } catch (cause) {
        if (!signal.aborted) errors.push(`${game.away.abbr} @ ${game.home.abbr}: ${errorMessage(cause)}`);
      }
    }));
    if (signal.aborted) break;
  }
  const [birthdays, history] = await Promise.all([birthdayRequest, historyRequest]);
  suggestions.push(...birthdays.suggestions, ...history.suggestions);
  errors.push(...birthdays.errors, ...history.errors);
  return { suggestions: suggestions.sort((a, b) => Date.parse(b.article.published) - Date.parse(a.article.published)), errors };
}

const generalMatchups = [{ id: 'NFL:0', label: 'NFL' }, { id: 'FANTASY:0', label: 'Fantasy' }] as const;

function newAngle(game: Game | undefined, season: number, week: number, section: AngleSection = 'angle'): Angle {
  return {
    id: '', season, week, game_id: game?.id ?? 'NFL:0', matchup: game ? `${game.away.name} @ ${game.home.name}` : 'NFL',
    kind: 'team', subject: game ? `${game.away.abbr} @ ${game.home.abbr}` : '', category: 'Other',
    title: '', narrative: '', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '',
    reviewed: false, status: 'draft', revision: 0, section, news_types: [],
    themes: [],
    post_to_x: false,
  };
}

export default function TheAngle({ games, season, week, user, storyId = null, storyOpenKey = 0, onSeen, section = 'angle', onOpenSection, active: visible = true }: Props) {
  const news = section === 'news';
  const [admin, setAdmin] = useState(false);
  const [rows, setRows] = useState<Angle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [viewError, setViewError] = useState('');
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<Angle | null>(null);
  const [photos, setPhotos] = useState<Array<{ path?: string; file?: File; preview: string }>>([]);
  const previews = useRef(new Set<string>());
  useEffect(() => () => { previews.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  function resetPhotos() {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
    setPhotos([]);
  }
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestoreFailed, setDraftRestoreFailed] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftRetry, setDraftRetry] = useState(0);
  const [restoreRetry, setRestoreRetry] = useState(0);
  const [kind, setKind] = useState<'all' | 'player' | 'team'>('all');
  const [newsFilter, setNewsFilter] = useState<NewsType[]>([]);
  const [leadGroup, setLeadGroup] = useState<typeof angleLeadGroups[number]>('Birthdays');
  const [suggestions, setSuggestions] = useState<AngleSuggestion[]>([]);
  const [suggestionErrors, setSuggestionErrors] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(0);
  const [linkedStory, setLinkedStory] = useState<Angle | null>(null);
  const [linkedReady, setLinkedReady] = useState<string | null>(null);
  const [linkedError, setLinkedError] = useState('');
  const editor = useRef<HTMLFormElement>(null);
  const weeklyGames = games.filter((game) => game.league === 'NFL' && game.seasonYear === season);
  const scheduleKey = weeklyGames.map((game) => `${game.id}:${game.date}`).sort().join('|');

  useEffect(() => {
    if (!user) return;
    let current = true;
    void loadAngleDraft(user.id, section).then((draft) => {
      if (!current) return;
      if (draft) {
        resetPhotos();
        setForm(draft.form);
        setDirty(true);
        setPhotos(draft.photos.map((photo) => {
          const preview = photo.file ? URL.createObjectURL(photo.file) : postPhotoUrl(photo.path ?? '');
          if (photo.file) previews.current.add(preview);
          return { ...photo, preview };
        }));
        setNotice('Your unfinished draft was restored on this device.');
      }
      setDraftRestoreFailed(false); setDraftError(''); setDraftReady(true);
    }).catch((cause: unknown) => {
      if (!current) return;
      console.error('Could not restore storyline draft', cause);
      setDraftRestoreFailed(true); setDraftReady(true);
      setDraftError('Could not restore your draft. Automatic saving is paused to protect it. Retry restoring it or explicitly discard it.');
    });
    return () => { current = false; };
  }, [user?.id, section, restoreRetry]);

  useEffect(() => {
    if (!user || !draftReady || draftRestoreFailed || busy) return;
    let current = true;
    setDraftSaving(true);
    void saveAngleDraft(user.id, section, form ? { form, photos: photos.map(({ path, file }) => ({ path, file })) } : undefined)
      .then(() => { if (current) { setDraftError(''); setDraftSaving(false); } })
      .catch((cause: unknown) => {
        console.error('Could not save storyline draft', cause);
        if (current) { setDraftError('Your latest draft changes could not be saved on this device. Keep this page open and retry saving.'); setDraftSaving(false); }
      });
    return () => { current = false; };
  }, [user?.id, section, draftReady, draftRestoreFailed, busy, form, photos, draftRetry]);

  useEffect(() => {
    if (!visible || !storyId) { setLinkedStory(null); setLinkedReady(null); setLinkedError(''); return; }
    let active = true;
    async function loadStory() {
      if (!supabase) throw new Error('Account services are not configured.');
      const result = await supabase.from('angles').select('*').eq('id', storyId).eq('status', 'published').maybeSingle();
      if (result.error) throw result.error;
      const story = result.data ? readAngles([result.data])[0] : null;
      if (active && story && angleSection(story) !== section) { onOpenSection?.(angleSection(story)); return; }
      if (active) { setLinkedStory(story); setLinkedReady(storyId); setLinkedError(''); }
    }
    void loadStory().catch((cause: unknown) => { if (active) setLinkedError(`Could not load the linked storyline: ${errorMessage(cause)}`); });
    return () => { active = false; };
  }, [visible, storyId, refresh]);

  useEffect(() => {
    if (storyId && linkedReady === storyId && linkedStory) {
      const target = document.getElementById(`angle-${storyId}`);
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    }
  }, [storyId, linkedReady, linkedStory?.id, storyOpenKey]);

  useEffect(() => {
    let active = true;
    if (!user || !supabase) { setAdmin(false); return; }
    void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', user.id).maybeSingle()).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setAdmin(data?.role === 'owner' || data?.role === 'admin');
      setAccessError('');
    }).catch((cause: unknown) => { if (active) { setAdmin(false); setAccessError(`Could not check editing access: ${errorMessage(cause)}`); } });
    return () => { active = false; };
  }, [user?.id, refresh]);

  useEffect(() => {
    if (!visible || !season || !week) return;
    let active = true;
    async function load() {
      if (!supabase) throw new Error('The Angle is unavailable: account services are not configured.');
      const next: Angle[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.rpc('angle_week_feed', { board_season: season, board_week: week, board_section: section })
          .order('updated_at', { ascending: false }).order('id').range(offset, offset + 499);
        if (result.error) throw result.error;
        next.push(...readAngles(result.data));
        if (!active) return;
        if (result.data.length < 500) break;
      }
      setRows(next); setLoaded(true); setLoadError('');
    }
    void load().catch((cause: unknown) => { if (active) setLoadError(`Could not load The Angle: ${errorMessage(cause)}`); });
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [visible, section, season, week, user?.id, refresh]);

  useEffect(() => {
    if (!visible || news || !admin || !scheduleKey) { setScanning(false); setSuggestions([]); return; }
    const controller = new AbortController();
    setScanning(true); setSuggestionErrors([]); setSuggestions([]);
    void fetchAngleSuggestions(weeklyGames, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setSuggestions(result.suggestions); setSuggestionErrors(result.errors); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setSuggestionErrors([errorMessage(cause)]);
    }).finally(() => { if (!controller.signal.aborted) setScanning(false); });
    return () => controller.abort();
  }, [visible, admin, scheduleKey, scan]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function openEditor(next: Angle | null) {
    if (!draftReady || draftRestoreFailed || busy) return;
    if (form) {
      setActionError('Publish or discard your current draft before opening another storyline.');
      editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    resetPhotos();
    setPhotos((next?.image_paths ?? []).map((path) => ({ path, preview: postPhotoUrl(path) })));
    setForm(next ? { ...next, picks: anglePicks(next) } : null); setDirty(false); setActionError(''); setNotice('');
    if (next) window.setTimeout(() => editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  async function discardDraft() {
    if (!user || busy || !window.confirm('Discard this draft and its unsaved changes? This cannot be undone.')) return;
    setBusy(true);
    try {
      await saveAngleDraft(user.id, section, undefined);
      resetPhotos(); setForm(null); setDirty(false); setDraftRestoreFailed(false); setDraftError('');
      setActionError(''); setNotice('Draft discarded on this device. Any previously saved server version is unchanged.');
    } catch (cause) {
      console.error('Could not discard storyline draft', cause);
      setDraftError('Could not remove the saved draft. It is still open; retry discarding it.');
    } finally { setBusy(false); }
  }
  function change<K extends keyof Angle>(key: K, value: Angle[K]) {
    setForm((previous) => previous ? { ...previous, [key]: value, reviewed: key === 'reviewed' ? Boolean(value) : false } : previous);
    setDirty(true);
  }
  function reviewSuggestion(suggestion: AngleSuggestion) {
    if (!season || !week) return;
    openEditor({ ...newAngle(suggestion.game, season, week), category: suggestion.category,
      kind: suggestion.playerName ? 'player' : 'team',
      subject: suggestion.playerName ?? suggestion.subject ?? `${suggestion.game.away.abbr} @ ${suggestion.game.home.abbr}`,
      evidence: suggestion.history?.evidence ?? '',
      source_url: suggestion.article.url ?? '', source_label: suggestion.sourceLabel ?? 'ESPN', title: '' });
  }
  async function save(status: Angle['status']) {
    if (!form || !supabase || !admin || busy) return;
    if (!angleThemes(form).length) { setActionError('Choose at least one theme. The first selected theme labels the notification.'); return; }
    const validation = status === 'published' ? anglePublishError(form) : !form.matchup.trim() ? 'Add the matchup before saving.' : '';
    if (validation) { setActionError(validation); return; }
    if (status === 'draft' && form.status === 'published' && !window.confirm('Move this published angle back to private drafts?')) return;
    setBusy(true); setActionError(''); setNotice('');
    const uploaded: string[] = [];
    let persisted = false;
    try {
      if (!user) throw new Error('Sign in to upload storyline photos.');
      const paths: string[] = [];
      for (const photo of photos) {
        if (photo.path) { paths.push(photo.path); continue; }
        if (!photo.file) throw new Error('Photo file is missing. Select it again.');
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[photo.file.type];
        if (!extension || !photo.file.size || photo.file.size > 5 * 1024 * 1024) throw new Error('Use JPG, PNG, WebP, or GIF photos up to 5 MB each.');
        const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage.from('livewire-photos').upload(path, photo.file, { contentType: photo.file.type, upsert: false });
        if (upload.error) throw upload.error;
        uploaded.push(path); paths.push(path);
      }
      const { id, revision, season: boardSeason, week: boardWeek } = form;
      const payload = angleWriteFields({ ...form, image_paths: paths }, status);
      if (payload.source_url && !isAngleSource(payload.source_url)) throw new Error('Use a valid HTTP or HTTPS source link.');
      const result = id
        ? await supabase.from('angles').update({ ...payload, revision: revision + 1 }).eq('id', id).eq('revision', revision).select('*').maybeSingle()
        : await supabase.from('angles').insert({ ...payload, season: boardSeason, week: boardWeek, section }).select('*').single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Another admin changed or removed this angle. Copy your changes before discarding this local draft and reopening the current version.');
      persisted = true;
      const saved = readAngles([result.data])[0];
      setRows((previous) => [saved, ...previous.filter((row) => row.id !== saved.id)]);
      if (saved.id === storyId) setLinkedStory(saved.status === 'published' ? saved : null);
      resetPhotos();
      setPhotos((saved.image_paths ?? []).map((path) => ({ path, preview: postPhotoUrl(path) })));
      setForm(saved); setDirty(false); setRefresh((value) => value + 1);
      if (status === 'published') {
        try {
          await saveAngleDraft(user.id, section, undefined);
          resetPhotos(); setForm(null);
        } catch (cause) {
          console.error('Story published, but the local draft could not be removed', cause);
          setActionError('Your story was published, but its local draft could not be removed. Discard the local draft; do not publish it again.');
        }
      }
      setNotice(status === 'published' ? `${news ? 'Fantasy News' : 'Angle'} published for this NFL week.` : 'Draft saved privately for admin review. You can keep editing.');
    } catch (cause) {
      let message = errorMessage(cause);
      if (!persisted && uploaded.length) {
        const cleanup = await supabase.storage.from('livewire-photos').remove(uploaded);
        if (cleanup.error) message += ` Unused photo cleanup failed: ${cleanup.error.message}`;
      }
      setActionError(message);
    }
    finally { setBusy(false); }
  }
  async function remove(angle: Angle) {
    if (!supabase || busy || !window.confirm(`Delete "${angle.title || 'Untitled angle'}"? This cannot be undone.`)) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await supabase.from('angles').delete().eq('id', angle.id).eq('revision', angle.revision).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Another admin changed this angle. Reload before deleting.');
      setRows((previous) => previous.filter((row) => row.id !== angle.id));
      if (angle.id === storyId) setLinkedStory(null);
      setNotice('Angle deleted.');
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const visibleLinked = linkedReady === storyId && linkedStory?.id === storyId ? linkedStory : null;
  const published = [
    ...(visibleLinked ? [visibleLinked] : []),
    ...rows.filter((row) => visible && angleVisibleInWeek(row, season, week) && row.id !== visibleLinked?.id && row.status === 'published' && (news
      ? !newsFilter.length || (row.news_types ?? []).some((type) => newsFilter.includes(type))
      : kind === 'all' || row.kind === kind)),
  ];
  const readObserver = useAnalystReadObserver(news ? 'news' : 'angle', onSeen, user?.id, published.map((angle) => angle.id).join('|'));
  const publishedKey = published.map((angle) => angle.id).join('|');
  useEffect(() => {
    if (!readObserver.root.current || !supabase) return;
    const client = supabase;
    let active = true;
    const stop = observePostViews(readObserver.root.current, async (id) => {
      const result = await client.rpc('record_angle_view', { story_id: id });
      if (result.error) throw result.error;
      if (result.data !== null) {
        const count = Number(result.data);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('The server returned an invalid storyline view count.');
        if (active) setViewCounts((previous) => ({ ...previous, [id]: Math.max(previous[id] ?? 0, count) }));
      }
      if (active) setViewError('');
    }, (cause) => {
      console.error('Could not record Angle view', cause);
      if (active) setViewError('Some storyline views could not be recorded. Reconnect or reopen The Angle to retry.');
    }, { minimumRatio: 0.01, bottomInset: 64, retryFailed: true });
    return () => { active = false; stop(); };
  }, [user?.id]);
  useEffect(() => {
    if (!admin || !supabase || !publishedKey) return;
    let active = true;
    void Promise.resolve(supabase.from('angle_view_counts').select('angle_id,view_count').in('angle_id', publishedKey.split('|'))).then(({ data, error }) => {
      if (error) throw error;
      const counts: Record<string, number> = Object.fromEntries(publishedKey.split('|').map((id) => [id, 0]));
      for (const row of data ?? []) {
        const count = Number(row.view_count);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('The server returned an invalid storyline view count.');
        counts[row.angle_id] = count;
      }
      if (active) { setViewCounts((previous) => Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, Math.max(previous[id] ?? 0, count)]))); setViewError(''); }
    }).catch((cause: unknown) => {
      console.error('Could not load Angle view counts', cause);
      if (active) setViewError('Could not load storyline view counts. Reopen The Angle to retry.');
    });
    return () => { active = false; };
  }, [admin, publishedKey, refresh]);
  const drafts = rows.filter((row) => row.status === 'draft' && row.season === season && row.week === week);
  const field = (key: 'title' | 'narrative' | 'pick', label: string, limit: number, multiline = false) => <label>{label}
    {multiline ? <textarea maxLength={limit} value={form?.[key] ?? ''} onChange={(event) => change(key, event.target.value)} />
      : <input type="text" maxLength={limit} value={form?.[key] ?? ''} onChange={(event) => change(key, event.target.value)} />}
  </label>;
  return <section className="angle-panel" hidden={!visible} aria-label={news ? 'Fantasy News' : 'The Angle'}>
    {visible && admin && <div className="angle-admin-bar">
      <button className="angle-create-button" disabled={busy || !draftReady || draftRestoreFailed || (!form && (!season || !week))} onClick={() => { if (form) editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else if (season && week) openEditor(newAngle(weeklyGames[0], season, week, section)); }}><Plus size={16} aria-hidden="true" />{form ? 'Continue draft' : news ? 'Create news' : 'Create an angle'}</button>
      {form && <button type="button" className="angle-create-button" disabled={busy} onClick={() => void discardDraft()}>Discard draft</button>}
      <span>{drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}</span>
    </div>}
    {form && <form className="angle-editor" aria-label={news ? 'Fantasy News editor' : 'Angle editor'} ref={editor} onSubmit={(event) => { event.preventDefault(); void save('published'); }}>
      <h3>{form.id ? `Edit ${news ? 'news' : 'storyline'}` : news ? 'New Fantasy News' : 'New storyline'}</h3><p>Drafts are private. First publish sends a push alert; edits don't.</p>
      <p role="status">{draftError ? 'Draft is not backed up. Keep this page open.' : draftSaving ? 'Saving draft on this device...' : 'Draft saved on this device. It stays open until you publish or discard it.'}</p>
      {!admin && <p role="status">Checking editing access. Your draft remains open.</p>}
      <fieldset className="angle-editor-fields" disabled={busy || !admin}>
        <label>Matchup<select value={form.game_id} onChange={(event) => {
          const value = event.target.value;
          if (value === form.game_id) return;
          const game = weeklyGames.find((item) => item.id === value);
          const sport = angleSports.find((item) => angleSportGameId(item.key) === value);
          const general = generalMatchups.find((item) => item.id === value);
          if (game) {
            setForm({ ...form, game_id: game.id, matchup: `${game.away.name} @ ${game.home.name}`,
              kind: 'team', subject: `${game.away.abbr} @ ${game.home.abbr}`, category: 'Other',
              evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: false });
            setDirty(true);
          } else if (general) {
            setForm({ ...form, game_id: general.id, matchup: general.label, kind: 'team', subject: '', category: 'Other',
              evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: false });
            setDirty(true);
          } else if (sport) {
            setForm({ ...form, game_id: value, matchup: '', kind: 'team', subject: '', category: 'Other',
              evidence: '', counterpoint: '', source_url: '', source_label: '', reviewed: false });
            setDirty(true);
          }
        }}>{!generalMatchups.some((item) => item.id === form.game_id) && !weeklyGames.some((game) => game.id === form.game_id) && angleSport(form.game_id).key === 'NFL' && <option value={form.game_id}>{form.matchup}</option>}
          <optgroup label="General">{generalMatchups.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>
          <optgroup label="NFL">{weeklyGames.map((game) => <option key={game.id} value={game.id}>{game.away.name} @ {game.home.name}</option>)}</optgroup>
          <optgroup label="Other sports">{angleSports.map((sport) => <option key={sport.key} value={angleSportGameId(sport.key)}>{sport.emoji} {sport.label}</option>)}</optgroup>
        </select></label>
        {angleSport(form.game_id).key !== 'NFL' && <label>{angleSport(form.game_id).label} matchup<input type="text" maxLength={200} placeholder="e.g. Lakers @ Celtics" value={form.matchup} onChange={(event) => change('matchup', event.target.value)} /></label>}
        {!news && angleSport(form.game_id).key !== 'NFL' && <p>Visible across all weeks for 7 days after first publication, then archived in {form.season} Week {form.week}. Edits do not restart the 7 days.</p>}
        <p>{form.subject || form.matchup || angleSport(form.game_id).label} · {form.category} · {form.season} · Week {form.week}</p>
        <fieldset className="livewire-themes"><legend>Theme (choose one or more)</legend>
          <div>{postThemes.map((theme) => <label key={theme.value}>
            <input type="checkbox" checked={angleThemes(form).includes(theme.value)} onChange={(event) => change('themes', event.target.checked
              ? [...angleThemes(form), theme.value] : angleThemes(form).filter((value) => value !== theme.value))} />
            <span className={`wire-primetime-tag tag-${theme.color}`}>{theme.label}</span>
          </label>)}</div>
          <small>{angleThemes(form)[0] ? `Notification prefix: ${postThemes.find((theme) => theme.value === angleThemes(form)[0])?.label}: (first selected theme)` : 'Select a theme first to set the notification prefix.'}</small>
        </fieldset>
        {news && <fieldset className="livewire-themes angle-news-types"><legend>Type <span>(choose one or both)</span></legend>
          <div>{newsTypes.map((type) => <label key={type.value}>
            <input type="checkbox" checked={(form.news_types ?? []).includes(type.value)} onChange={(event) => change('news_types', event.target.checked
              ? [...(form.news_types ?? []), type.value] : (form.news_types ?? []).filter((value) => value !== type.value))} />
            <span className={`wire-primetime-tag tag-${type.color}`}>{type.label}</span>
          </label>)}</div>
        </fieldset>}
        {form.source_url && isAngleSource(form.source_url) && <p><a href={form.source_url} target="_blank" rel="noopener noreferrer">{form.source_label || 'Original source'} <ExternalLink size={12} aria-hidden="true" /></a> · Source retained automatically</p>}
        {!form.source_url && <p>Include sources and context in your storyline.</p>}
        {(form.evidence || form.counterpoint) && <details><summary>Retained source context</summary>{form.evidence && <p>{form.evidence}</p>}{form.counterpoint && <p>{form.counterpoint}</p>}</details>}
        {field('title', 'Headline (your own words)', 140)}
        {field('narrative', 'Storyline', 1500, true)}
        <div className="angle-pick-editor">
          <p>Admin picks (optional opinions). Add each bet separately.</p>
          {(form.picks ?? []).map((pick, index) => <div key={pick.id}>
            <label>Pick {index + 1} type<select className="pick-type-select" value={pickCategory(pick)} onChange={(event) => {
              const category = pickCategories.find((value) => value === event.target.value);
              if (category) change('picks', (form.picks ?? []).map((item) => item.id === pick.id ? { ...item, category } : item));
            }}>{pickCategories.map((category) => <option key={category} value={category}>{pickCategoryLabels[category]}</option>)}</select></label>
            <label>Admin pick {index + 1}<textarea maxLength={500} value={pick.text} onChange={(event) => change('picks', (form.picks ?? []).map((item) => item.id === pick.id ? { ...item, text: event.target.value, result: 'pending' as const } : item))} /></label>
            <button type="button" onClick={() => change('picks', (form.picks ?? []).filter((item) => item.id !== pick.id))}>Remove pick {index + 1}</button>
          </div>)}
          <button type="button" onClick={() => change('picks', [...(form.picks ?? []), { id: crypto.randomUUID(), text: '', result: 'pending', category: 'straight' }])}>{form.picks?.length ? 'Add another pick' : 'Add a pick'}</button>
          <p>Straights and parlays have separate records. Sprinkles are shown but excluded from records. Enter each parlay as one pick, not one pick per leg.</p>
        </div>
        <label htmlFor={`angle-${section}-photos`}>Photos (optional, up to four)</label>
        <input id={`angle-${section}-photos`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={photos.length >= 4} onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = '';
          if (photos.length + files.length > 4) { setActionError('Attach at most four photos.'); return; }
          if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) {
            setActionError('Use JPG, PNG, WebP, or GIF photos up to 5 MB each.'); return;
          }
          setActionError(''); setDirty(true); change('reviewed', false);
          setPhotos((current) => [...current, ...files.map((file) => { const preview = URL.createObjectURL(file); previews.current.add(preview); return { file, preview }; })]);
        }} />
        <small className="livewire-photo-help">JPG, PNG, WebP or GIF · 5 MB each · Photo URLs are public, even in drafts.</small>
        {!!photos.length && <div className="livewire-photo-previews">{photos.map((photo, index) => <div key={photo.preview}><OfflineImage src={photo.preview} alt={`Attachment preview ${index + 1}`} /><button type="button" onClick={() => {
          if (photo.file) { URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview); }
          setPhotos((current) => current.filter((_, item) => item !== index)); change('reviewed', false);
        }}>Remove photo {index + 1}</button></div>)}</div>}
        <label className="angle-review-check"><input type="checkbox" checked={form.reviewed} onChange={(event) => change('reviewed', event.target.checked)} />I verified the source, matchup, and facts, and personal details are publicly reported.</label>
        <div className="angle-actions"><button type="button" onClick={() => void save('draft')}>{form.status === 'published' ? 'Unpublish to drafts' : 'Save private draft'}</button><button type="submit" className="angle-publish">{busy ? 'Saving...' : news ? 'Publish news' : 'Publish angle'}</button>
          <label className="x-publishing-choice"><input type="checkbox" checked={form.post_to_x ?? false} disabled={busy || !!form.published_at} onChange={(event) => change('post_to_x', event.target.checked)} />Post to X on first publication</label>
        </div>
        <p>Requires a connected X account. Edits and republishing do not create another tweet.</p>
      </fieldset>
    </form>}
    {draftError && <p className="feed-warning" role="alert">{draftError} <button disabled={busy} onClick={() => {
      if (draftRestoreFailed) { setDraftReady(false); setRestoreRetry((value) => value + 1); }
      else setDraftRetry((value) => value + 1);
    }}>{draftRestoreFailed ? 'Retry restoring draft' : 'Retry saving draft'}</button>{draftRestoreFailed && <button disabled={busy} onClick={() => void discardDraft()}>Discard saved draft</button>}</p>}
    {accessError && <p className="feed-warning" role="status">{accessError}</p>}
    {actionError && <p className="feed-warning" role="alert">{actionError}</p>}
    {notice && <p className="angle-notice" role="status">{notice}</p>}
    {visible && <>
    <p className="angle-disclaimer">Editorial opinions, not predictions or betting recommendations.</p>
    {loadError && <p className="feed-warning" role="alert">{loadError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {readObserver.error && <p className="feed-warning" role="status">{readObserver.error}</p>}
    {viewError && <p className="feed-warning" role="status">{viewError}</p>}
    {storyId && linkedError && <p className="feed-warning" role="alert">{linkedError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {storyId && !linkedError && linkedReady !== storyId && <p role="status">Loading your linked storyline...</p>}
    {storyId && linkedReady === storyId && !linkedStory && <p role="status">This storyline is no longer published. You can browse the current week's storylines below.</p>}
    {news ? <div className="angle-filters livewire-theme-filters" role="group" aria-label="Filter Fantasy News">
      <button aria-pressed={!newsFilter.length} onClick={() => setNewsFilter([])}>All news</button>
      {newsTypes.map((type) => <button key={type.value} aria-pressed={newsFilter.includes(type.value)} onClick={() => setNewsFilter((current) => current.includes(type.value) ? current.filter((value) => value !== type.value) : [...current, type.value])}><span className={`wire-primetime-tag tag-${type.color}`}>{type.label}</span></button>)}
    </div> : <div className="angle-filters" role="group" aria-label="Filter published angles">{(['all', 'player', 'team'] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All angles' : value === 'player' ? 'Players' : 'Team matchups'}</button>)}</div>}
    {!season || !week ? <p role="status">Waiting for the selected NFL week...</p> : !loaded && !loadError ? <p role="status">{news ? 'Loading Fantasy News...' : 'Loading The Angle...'}</p> : loaded && !published.length && <p className="angle-empty">{news ? rows.some((row) => row.status === 'published') ? 'No Fantasy News matches this filter.' : 'No Fantasy News published for this week yet.' : rows.some((row) => row.status === 'published') ? 'No published angles match this filter.' : 'No angles published for this week yet. Verified storylines from the GameWire desk will appear here.'}</p>}
    {admin && visible && <XPublishingStatus />}
    <div className="angle-cards" ref={readObserver.root}>{published.map((angle) => <article className="angle-card" id={`angle-${angle.id}`} data-post-id={angle.id} key={angle.id} tabIndex={angle.id === storyId ? -1 : undefined} aria-label={angle.id === storyId ? 'Storyline opened from notification' : undefined}>
      <div className="angle-card-meta"><span>{angle.category}</span>{news
        ? newsTypes.filter((type) => angle.news_types?.includes(type.value)).map((type) => <span key={type.value} className={`wire-primetime-tag tag-${type.color}`}>{type.label}</span>)
        : <span>{angle.kind === 'player' ? 'PLAYER ANGLE' : 'MATCHUP ANGLE'}</span>}</div>
      <h3>{angle.title}</h3>{angle.subject && <p className="angle-subject">{angle.subject}</p>}<p className="angle-matchup">{angleSport(angle.game_id).key === 'NFL' ? '' : `${angleSport(angle.game_id).emoji} ${angleSport(angle.game_id).label} · `}{angle.matchup} · {angle.season} · Week {angle.week}</p>
      <p className="angle-story">{angle.narrative}</p>
      {angle.evidence && <div className="angle-context"><h4>The supporting context</h4><p>{angle.evidence}</p></div>}
      {angle.counterpoint && <div className="angle-counterpoint"><h4>The other side</h4><p>{angle.counterpoint}</p></div>}
      <AnglePicks picks={anglePicks(angle)} emoji={angleSport(angle.game_id).emoji} />
      <PostGallery paths={angle.image_paths ?? []} title={angle.title} />
      {admin && <span className="livewire-views">{viewCounts[angle.id] === undefined ? 'Views unavailable' : `${new Intl.NumberFormat().format(viewCounts[angle.id])} ${viewCounts[angle.id] === 1 ? 'view' : 'views'}`}</span>}
      {isAngleSource(angle.source_url) && <a href={angle.source_url} target="_blank" rel="noopener noreferrer"><BookOpen size={14} aria-hidden="true" />{angle.source_label}<ExternalLink size={12} aria-hidden="true" /></a>}
      {admin && <div className="angle-actions"><button disabled={busy} onClick={() => openEditor(angle)}>{news ? 'Edit news' : 'Edit angle'}</button><button disabled={busy} onClick={() => void remove(angle)}>Delete</button></div>}
    </article>)}</div>
    {admin && <section className="angle-admin" aria-label={news ? 'Fantasy News admin desk' : 'The Angle admin desk'}>
      <h3>Admin desk <span>Private</span></h3>{!news && <><p>Verify every lead before publishing.</p>
      <div className="angle-actions"><button disabled={scanning || !weeklyGames.length} onClick={() => setScan((value) => value + 1)}>{scanning ? 'Checking news, birthdays, and matchup history...' : 'Refresh suggestions'}</button></div>
      {!weeklyGames.length && <p>No NFL matchups are available for this week. You can create a general NFL or Fantasy post; matchup suggestions need a loaded game.</p>}
      {suggestionErrors.length > 0 && <p className="feed-warning" role="status">Some suggestion feeds could not load. {suggestionErrors.join(' ')}</p>}
      {!scanning && weeklyGames.length > 0 && !suggestions.length && <p>No source-backed news, birthday, or matchup-history leads found in the available coverage. Nothing has been invented; you can create an angle manually.</p>}
      <div className="angle-filters" role="group" aria-label="Select lead category">
        {angleLeadGroups.map((group) => {
          const count = suggestions.filter((suggestion) => angleLeadGroup(suggestion.category) === group).length;
          if (group === 'Other storylines' && !count && leadGroup !== group) return null;
          return <button key={group} aria-pressed={leadGroup === group} aria-controls="angle-selected-leads" onClick={() => setLeadGroup(group)}>{group} ({count})</button>;
        })}
      </div>
      {angleLeadGroups.map((group) => {
        if (group !== leadGroup) return null;
        const leads = suggestions.filter((suggestion) => angleLeadGroup(suggestion.category) === group);
        return <section className="angle-lead-group" id="angle-selected-leads" aria-label={`${group} leads`} key={group}>
          <header><h4>{group}</h4><span>{leads.length} {leads.length === 1 ? 'LEAD' : 'LEADS'}</span></header>
          {!leads.length && <p>{scanning ? 'Checking available sources...' : 'No qualifying leads in the available coverage.'}</p>}
          <div className="angle-suggestions">{leads.map((suggestion) => <article key={suggestion.key}><span>{suggestion.category} · Unverified lead</span><b>{suggestion.article.headline}</b><small>{suggestion.game.away.abbr} @ {suggestion.game.home.abbr} · {new Date(suggestion.article.published).toLocaleDateString()}</small>{suggestion.history && <><p>{suggestion.article.description}</p><details><summary>Record, window, and game sources</summary><p>{suggestion.history.evidence}</p><ul>{suggestion.history.meetings.map((meeting) => <li key={meeting.url}><a href={meeting.url} target="_blank" rel="noopener noreferrer">{meeting.label}</a></li>)}</ul></details></>}<a href={suggestion.article.url} target="_blank" rel="noopener noreferrer">Read {suggestion.sourceLabel ?? 'ESPN'} source</a><button disabled={busy} onClick={() => reviewSuggestion(suggestion)}>Review this lead</button></article>)}</div>
        </section>;
      })}</>}
      <h4>Saved drafts ({drafts.length})</h4>
      {drafts.map((draft) => <div className="angle-draft" key={draft.id}><span><b>{draft.title || (news ? 'Untitled news' : 'Untitled angle')}</b><small>{draft.matchup} · {draft.category}</small></span><button disabled={busy} onClick={() => openEditor(draft)}>Review draft</button><button disabled={busy} onClick={() => void remove(draft)}>Delete</button></div>)}
    </section>}
    </>}
  </section>;
}
