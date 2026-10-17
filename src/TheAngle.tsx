import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { BookOpen, ExternalLink, Lightbulb } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { angleCategories, anglePublishError, angleWriteFields, isAngleSource, readAngles, selectAngleSuggestions } from './services/theAngle';
import type { Angle, AngleSuggestion } from './services/theAngle';
import { fetchFavoriteNews } from './services/sportsData';
import { fetchBirthdaySuggestions } from './services/angleBirthdays';
import type { Game } from './services/sportsData';

type Props = { games: Game[]; season: number | null; week: number | null; user: User | null };
const errorMessage = (cause: unknown) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
  ? cause.message : 'The Angle request failed. Please retry.';

async function fetchAngleSuggestions(games: Game[], signal: AbortSignal) {
  const birthdayRequest = fetchBirthdaySuggestions(games, signal);
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
  const birthdays = await birthdayRequest;
  suggestions.push(...birthdays.suggestions);
  errors.push(...birthdays.errors);
  return { suggestions: suggestions.sort((a, b) => Date.parse(b.article.published) - Date.parse(a.article.published)), errors };
}

function newAngle(game: Game, season: number, week: number): Angle {
  return {
    id: '', season, week, game_id: game.id, matchup: `${game.away.name} @ ${game.home.name}`,
    kind: 'team', subject: `${game.away.abbr} @ ${game.home.abbr}`, category: 'Other',
    title: '', narrative: '', evidence: '', counterpoint: '', pick: '', source_url: '', source_label: '',
    reviewed: false, status: 'draft', revision: 0,
  };
}

export default function TheAngle({ games, season, week, user }: Props) {
  const [admin, setAdmin] = useState(false);
  const [rows, setRows] = useState<Angle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<Angle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'all' | 'player' | 'team'>('all');
  const [suggestions, setSuggestions] = useState<AngleSuggestion[]>([]);
  const [suggestionErrors, setSuggestionErrors] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(0);
  const editor = useRef<HTMLFormElement>(null);
  const weeklyGames = games.filter((game) => game.league === 'NFL' && game.seasonYear === season);
  const scheduleKey = weeklyGames.map((game) => `${game.id}:${game.date}`).sort().join('|');

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
    if (!season || !week) return;
    let active = true;
    async function load() {
      if (!supabase) throw new Error('The Angle is unavailable: account services are not configured.');
      const next: Angle[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase.from('angles').select('*').eq('season', season).eq('week', week)
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
  }, [season, week, user?.id, refresh]);

  useEffect(() => {
    if (!admin || !scheduleKey) { setScanning(false); setSuggestions([]); return; }
    const controller = new AbortController();
    setScanning(true); setSuggestionErrors([]); setSuggestions([]);
    void fetchAngleSuggestions(weeklyGames, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setSuggestions(result.suggestions); setSuggestionErrors(result.errors); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setSuggestionErrors([errorMessage(cause)]);
    }).finally(() => { if (!controller.signal.aborted) setScanning(false); });
    return () => controller.abort();
  }, [admin, scheduleKey, scan]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function openEditor(next: Angle | null) {
    if (dirty && !window.confirm('Discard the unsaved changes to this angle?')) return;
    setForm(next); setDirty(false); setActionError(''); setNotice('');
    if (next) window.setTimeout(() => editor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  function change<K extends keyof Angle>(key: K, value: Angle[K]) {
    setForm((previous) => previous ? { ...previous, [key]: value, reviewed: key === 'reviewed' ? Boolean(value) : false } : previous);
    setDirty(true);
  }
  function reviewSuggestion(suggestion: AngleSuggestion) {
    if (!season || !week) return;
    openEditor({ ...newAngle(suggestion.game, season, week), category: suggestion.category,
      kind: suggestion.playerName ? 'player' : 'team',
      subject: suggestion.playerName ?? `${suggestion.game.away.abbr} @ ${suggestion.game.home.abbr}`,
      source_url: suggestion.article.url ?? '', source_label: suggestion.sourceLabel ?? 'ESPN', title: '' });
  }
  async function save(status: Angle['status']) {
    if (!form || !supabase || busy) return;
    const validation = status === 'published' ? anglePublishError(form) : '';
    if (validation) { setActionError(validation); return; }
    if (status === 'draft' && form.status === 'published' && !window.confirm('Move this published angle back to private drafts?')) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const { id, revision, season: boardSeason, week: boardWeek } = form;
      const payload = angleWriteFields(form, status);
      if (payload.source_url && !isAngleSource(payload.source_url)) throw new Error('Use a valid HTTP or HTTPS source link.');
      const result = id
        ? await supabase.from('angles').update({ ...payload, revision: revision + 1 }).eq('id', id).eq('revision', revision).select('*').maybeSingle()
        : await supabase.from('angles').insert({ ...payload, season: boardSeason, week: boardWeek }).select('*').single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Another admin changed or removed this angle. Cancel and reopen the current version before saving.');
      const saved = readAngles([result.data])[0];
      setRows((previous) => [saved, ...previous.filter((row) => row.id !== saved.id)]);
      setForm(null); setDirty(false); setRefresh((value) => value + 1);
      setNotice(status === 'published' ? 'Angle published for this NFL week.' : 'Draft saved privately for admin review.');
    } catch (cause) { setActionError(errorMessage(cause)); }
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
      setNotice('Angle deleted.');
    } catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const published = rows.filter((row) => row.status === 'published' && (kind === 'all' || row.kind === kind));
  const drafts = rows.filter((row) => row.status === 'draft');
  const field = (key: 'title' | 'subject' | 'source_url' | 'source_label' | 'narrative' | 'evidence' | 'counterpoint' | 'pick', label: string, limit: number, multiline = false) => <label>{label}
    {multiline ? <textarea maxLength={limit} value={form?.[key] ?? ''} onChange={(event) => change(key, event.target.value)} />
      : <input type={key === 'source_url' ? 'url' : 'text'} maxLength={limit} value={form?.[key] ?? ''} onChange={(event) => change(key, event.target.value)} />}
  </label>;
  return <section className="angle-panel" aria-label="The Angle">
    <header className="angle-heading"><div><span className="eyebrow">BEYOND THE BOX SCORE</span><h2><Lightbulb size={24} aria-hidden="true" />The Angle</h2><p>Players. Matchups. The story behind the spot.</p></div><span>{season && week ? `${season} · Week ${week}` : 'Loading NFL week...'}</span></header>
    <p className="angle-disclaimer">Editorial storylines, not predictions. Past results and personal narratives do not guarantee future performance. Any pick is an admin opinion, not a recommendation or a verified edge.</p>
    {accessError && <p className="feed-warning" role="status">{accessError}</p>}
    {loadError && <p className="feed-warning" role="alert">{loadError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {actionError && <p className="feed-warning" role="alert">{actionError}</p>}
    {notice && <p className="angle-notice" role="status">{notice}</p>}
    <div className="angle-filters" role="group" aria-label="Filter published angles">{(['all', 'player', 'team'] as const).map((value) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All angles' : value === 'player' ? 'Players' : 'Team matchups'}</button>)}</div>
    {!season || !week ? <p role="status">Waiting for the selected NFL week...</p> : !loaded && !loadError ? <p role="status">Loading The Angle...</p> : loaded && !published.length && <p className="angle-empty">{rows.some((row) => row.status === 'published') ? 'No published angles match this filter.' : 'No angles published for this week yet. Verified storylines from the GameWire desk will appear here.'}</p>}
    <div className="angle-cards">{published.map((angle) => <article className="angle-card" key={angle.id}>
      <div className="angle-card-meta"><span>{angle.category}</span><span>{angle.kind === 'player' ? 'PLAYER ANGLE' : 'MATCHUP ANGLE'}</span></div>
      <h3>{angle.title}</h3><p className="angle-subject">{angle.subject}</p><p className="angle-matchup">{angle.matchup}</p>
      <p className="angle-story">{angle.narrative}</p>
      <div className="angle-context"><h4>The supporting context</h4><p>{angle.evidence}</p></div>
      <div className="angle-counterpoint"><h4>The other side</h4><p>{angle.counterpoint}</p></div>
      {angle.pick && <div className="angle-pick"><h4>Admin pick · Opinion</h4><p>{angle.pick}</p></div>}
      {isAngleSource(angle.source_url) && <a href={angle.source_url} target="_blank" rel="noopener noreferrer"><BookOpen size={14} aria-hidden="true" />{angle.source_label}<ExternalLink size={12} aria-hidden="true" /></a>}
      {admin && <div className="angle-actions"><button disabled={busy} onClick={() => openEditor(angle)}>Edit angle</button><button disabled={busy} onClick={() => void remove(angle)}>Delete</button></div>}
    </article>)}</div>
    {admin && <section className="angle-admin" aria-label="The Angle admin desk">
      <h3>Admin desk <span>Private</span></h3><p>News suggestions are keyword-matched leads, not verified claims. Birthday leads use Wikidata birth dates matched by ESPN player ID for loaded QB/RB/WR/TE rosters, within three days of game day (Eastern time). Coverage may be incomplete. Check the source, player identity, opponent, dates, sample size, and current availability. Write your own summary before publishing.</p>
      <p>Public life events: use only a public announcement or reliable report. Link to it and summarize in your own words; omit children's names, photos, and other unnecessary family details. Birthdays and parenthood do not establish a performance advantage.</p>
      <div className="angle-actions"><button disabled={busy || !weeklyGames.length} onClick={() => { if (season && week && weeklyGames[0]) openEditor(newAngle(weeklyGames[0], season, week)); }}>Create an angle</button><button disabled={busy || !weeklyGames.length} onClick={() => { if (season && week && weeklyGames[0]) openEditor({ ...newAngle(weeklyGames[0], season, week), kind: 'player', category: 'Public life event', subject: '' }); }}>Add public announcement</button><button disabled={scanning || !weeklyGames.length} onClick={() => setScan((value) => value + 1)}>{scanning ? 'Checking news and birthdays...' : 'Refresh suggestions'}</button></div>
      {!weeklyGames.length && <p>No NFL matchups are available for this week. Manual creation and suggestions need a loaded matchup.</p>}
      {suggestionErrors.length > 0 && <p className="feed-warning" role="status">Some suggestion feeds could not load. {suggestionErrors.join(' ')}</p>}
      {!scanning && weeklyGames.length > 0 && !suggestions.length && <p>No source-backed news or birthday leads found in the available coverage. Nothing has been invented; you can create an angle manually.</p>}
      <div className="angle-suggestions">{suggestions.map((suggestion) => <article key={suggestion.key}><span>{suggestion.category} · Unverified lead</span><b>{suggestion.article.headline}</b><small>{suggestion.game.away.abbr} @ {suggestion.game.home.abbr} · {new Date(suggestion.article.published).toLocaleDateString()}</small><a href={suggestion.article.url} target="_blank" rel="noopener noreferrer">Read {suggestion.sourceLabel ?? 'ESPN'} source</a><button disabled={busy} onClick={() => reviewSuggestion(suggestion)}>Review this lead</button></article>)}</div>
      <h4>Saved drafts ({drafts.length})</h4>
      {drafts.map((draft) => <div className="angle-draft" key={draft.id}><span><b>{draft.title || 'Untitled angle'}</b><small>{draft.matchup} · {draft.category}</small></span><button disabled={busy} onClick={() => openEditor(draft)}>Review draft</button><button disabled={busy} onClick={() => void remove(draft)}>Delete</button></div>)}
      {form && <form className="angle-editor" ref={editor} onSubmit={(event) => { event.preventDefault(); void save('published'); }}>
        <h3>{form.id ? 'Edit angle' : 'New angle'}</h3><p>Draft changes are private. Save before leaving this tab. Publishing is always an explicit admin action.</p>
        <fieldset disabled={busy}>
          <label>Matchup<select value={form.game_id} onChange={(event) => {
            const game = weeklyGames.find((item) => item.id === event.target.value);
            if (game) { change('game_id', game.id); change('matchup', `${game.away.name} @ ${game.home.name}`); }
          }}>{!weeklyGames.some((game) => game.id === form.game_id) && <option value={form.game_id}>{form.matchup}</option>}{weeklyGames.map((game) => <option key={game.id} value={game.id}>{game.away.name} @ {game.home.name}</option>)}</select></label>
          <label>Angle type<select value={form.kind} onChange={(event) => change('kind', event.target.value === 'player' ? 'player' : 'team')}><option value="team">Team matchup</option><option value="player">Player</option></select></label>
          <label>Storyline<select value={form.category} onChange={(event) => {
            const category = angleCategories.find((item) => item === event.target.value); if (category) change('category', category);
          }}>{angleCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
          {field('subject', 'Player or team focus', 120)}{field('title', 'Headline (your own words)', 140)}
          {field('narrative', 'The storyline', 1500, true)}{field('evidence', 'Supporting context / cited history', 1500, true)}
          {field('counterpoint', 'The other side / what could weaken this angle', 1000, true)}
          {field('pick', 'Admin pick (optional opinion; no guarantees)', 500, true)}
          {field('source_label', 'Source name', 120)}{field('source_url', 'Source link (HTTP or HTTPS)', 2048)}
          <label className="angle-review-check"><input type="checkbox" checked={form.reviewed} onChange={(event) => change('reviewed', event.target.checked)} />I checked the source, matchup, and factual claims. Personal events are publicly announced or reliably reported, with unnecessary family details omitted. This is editorial context, not a guaranteed outcome.</label>
          <div className="angle-actions"><button type="button" onClick={() => void save('draft')}>{form.status === 'published' ? 'Unpublish to drafts' : 'Save private draft'}</button><button type="submit" className="angle-publish">{busy ? 'Saving...' : 'Publish angle'}</button><button type="button" onClick={() => openEditor(null)}>Cancel</button></div>
        </fieldset>
      </form>}
    </section>}
  </section>;
}
