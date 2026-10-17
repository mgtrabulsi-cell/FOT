import OfflineImage from './OfflineImage';
import { usePublicDataRevision } from './usePublicDataRevision';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './services/supabaseClient';
import { observePostViews } from './services/livewireViews';
import { loadLivewireDraft, saveLivewireDraft } from './services/livewireDrafts';
import PostPhotoViewer from './PostPhotoViewer';

const postThemes = [
  { value: 'news', label: 'News', color: 'tnf' },
  { value: 'fantasy', label: 'Fantasy', color: 'snf' },
  { value: 'betting', label: 'Betting', color: 'mnf' },
] as const;
type PostTheme = typeof postThemes[number]['value'];
type Post = { id: string; author_id: string | null; author_name: string; title: string | null; body: string; themes?: PostTheme[]; image_paths?: string[]; source_url: string | null; created_at: string; updated_at: string; view_count?: number };
type Admin = { user_id: string; role: 'owner' | 'admin'; display_name: string };
type DraftPhoto = { path?: string; file?: File; preview: string };

function photoUrl(path: string) {
  return supabase?.storage.from('livewire-photos').getPublicUrl(path).data.publicUrl ?? '';
}

function safeNewsLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function LiveWire({ user, postId = null, onPostSeen }: { user: User | null; postId?: string | null; onPostSeen?: (postId: string) => Promise<void> }) {
  const publicRevision = usePublicDataRevision('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewError, setViewError] = useState('');
  const [readError, setReadError] = useState('');
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const feedElement = useRef<HTMLDivElement | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [themes, setThemes] = useState<PostTheme[]>([]);
  const [themeFilters, setThemeFilters] = useState<PostTheme[]>([]);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftRestoreFailed, setDraftRestoreFailed] = useState(false);
  const [draftRetry, setDraftRetry] = useState(0);
  const [expandedPhoto, setExpandedPhoto] = useState<{ src: string; alt: string } | null>(null);
  const previews = useRef(new Set<string>());
  useEffect(() => () => { previews.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  function resetPhotos() {
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
    setPhotos([]);
  }
  async function savePost() {
    if (!supabase || !user) throw new Error('Sign in to upload photos.');
    const storage = supabase.storage.from('livewire-photos');
    const uploaded: string[] = [];
    try {
      const paths: string[] = [];
      for (const photo of photos) {
        if (photo.path) { paths.push(photo.path); continue; }
        if (!photo.file) throw new Error('Photo file is missing. Select it again.');
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[photo.file.type];
        if (!extension || photo.file.size > 5 * 1024 * 1024) throw new Error('Use JPG, PNG, WebP, or GIF photos up to 5 MB each.');
        const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const result = await storage.upload(path, photo.file, { contentType: photo.file.type, upsert: false });
        if (result.error) throw result.error;
        uploaded.push(path); paths.push(path);
      }
      const result = await supabase.rpc('save_livewire_post', { post_body: body, post_title: title.trim(), post_source: source.trim() || null, post_id: editing, post_images: paths, post_themes: themes });
      if (result.error) throw result.error;
      return { error: null };
    } catch (cause) {
      const message = cause !== null && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
        ? cause.message : 'Could not save the photos or post. Please retry.';
      if (uploaded.length) {
        const cleanup = await storage.remove(uploaded);
        if (cleanup.error) throw new Error(`${message} Unused upload cleanup also failed: ${cleanup.error.message}`);
      }
      throw new Error(message);
    }
  }
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [linkedPost, setLinkedPost] = useState<Post | null>(null);
  const [linkedMissing, setLinkedMissing] = useState(false);
  const [linkedReady, setLinkedReady] = useState<string | null>(null);
  const focusedPost = useRef<HTMLElement | null>(null);
  const scrolledPost = useRef<string | null>(null);
  const role = admins.find((admin) => admin.user_id === user?.id)?.role;
  useEffect(() => {
    if (!user) return;
    let active = true;
    setDraftReady(false);
    void loadLivewireDraft(user.id).then((draft) => {
      if (!active) return;
      if (draft) {
        resetPhotos();
        setTitle(draft.title); setBody(draft.body); setSource(draft.source); setThemes(draft.themes); setEditing(draft.editing);
        setPhotos(draft.photos.map((photo) => {
          const preview = photo.file ? URL.createObjectURL(photo.file) : photoUrl(photo.path ?? '');
          if (photo.file) previews.current.add(preview);
          return { ...photo, preview };
        }));
        setNotice('Your saved draft was restored on this device.');
      }
      setDraftReady(true);
      setDraftRestoreFailed(false);
      setDraftError('');
    }).catch((cause: unknown) => {
      if (active) {
        console.error('Could not restore LIVEWIRE draft', cause);
        setDraftError('Could not restore your saved draft. You can still edit below, but automatic saving is paused to protect the previous copy. Retry restoring it, or discard it to start a new saved draft.');
        setDraftRestoreFailed(true);
        setDraftReady(true);
      }
    });
    return () => { active = false; };
  }, [user?.id, draftRetry]);
  useEffect(() => {
    if (!user || !draftReady || draftRestoreFailed) return;
    let active = true;
    void saveLivewireDraft(user.id, {
      title, body, source, themes, editing, photos: photos.map(({ path, file }) => ({ path, file })),
    }).then(() => { if (active) setDraftError(''); }).catch((cause: unknown) => {
      console.error('Could not save LIVEWIRE draft', cause);
      if (active) setDraftError('Your latest draft changes could not be saved on this device. Keep this page open and try again.');
    });
    return () => { active = false; };
  }, [user?.id, draftReady, draftRestoreFailed, title, body, source, themes, editing, photos]);

  useEffect(() => {
    let active = true;
    if (!user) setAdmins([]);
    setAccessError('');
    if (supabase && user) {
      void Promise.resolve(supabase.from('livewire_roles').select('user_id,role,display_name')).then(({ data, error }) => {
        if (!active) return;
        if (error) { setAdmins([]); setAccessError(`Could not check LIVEWIRE permissions: ${error.message}`); }
        else setAdmins(data ?? []);
      }).catch((cause: unknown) => {
        if (active) { setAdmins([]); setAccessError(cause instanceof Error ? cause.message : 'Could not check LIVEWIRE permissions.'); }
      });
    }
    return () => { active = false; };
  }, [user?.id, refresh]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError('LIVEWIRE is unavailable: account services are not configured.'); return; }
      const client = supabase;
      async function loadPosts() {
        const data: Post[] = [];
        for (let offset = 0; offset <= limit; offset += 500) {
          let query = client.from('livewire_posts').select('*');
          if (themeFilters.length) query = query.overlaps('themes', themeFilters);
          const page = await query.order('created_at', { ascending: false }).order('id', { ascending: false })
            .range(offset, Math.min(offset + 499, limit));
          if (page.error) return { data: [], error: page.error };
          data.push(...page.data);
          if (page.data.length < Math.min(500, limit + 1 - offset)) break;
        }
        return { data, error: null };
      }
      const feed = await loadPosts();
      if (!active) return;
      if (postId) {
        const linked = await client.from('livewire_posts').select('*').eq('id', postId).maybeSingle();
        if (!active) return;
        if (linked.error) { setError(`Could not load the requested post: ${linked.error.message}`); return; }
        setLinkedPost(linked.data);
        setLinkedMissing(!linked.data);
        setLinkedReady(postId);
      } else {
        setLinkedPost(null); setLinkedMissing(false); setLinkedReady(null);
      }
      if (feed.error) {
        setError(`Could not refresh LIVEWIRE: ${feed.error.message}`);
        return;
      }
      setPosts((feed.data ?? []).slice(0, limit));
      setHasMore((feed.data?.length ?? 0) > limit);
      setLoaded(true);
      setError('');
    }
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load LIVEWIRE. Please retry.');
    });
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, refresh, limit, postId, themeFilters, publicRevision]);

  useEffect(() => {
    if (!postId) { scrolledPost.current = null; return; }
    if (linkedReady === postId && linkedPost && focusedPost.current && scrolledPost.current !== postId) {
      focusedPost.current.scrollIntoView({ block: 'center' });
      focusedPost.current.focus({ preventScroll: true });
      scrolledPost.current = postId;
    }
  }, [postId, linkedReady, linkedPost, posts]);

  const visiblePosts = linkedPost && linkedPost.id === postId && !posts.some((post) => post.id === postId)
    ? [linkedPost, ...posts] : posts;
  useEffect(() => {
    if (!feedElement.current || !supabase) return;
    const client = supabase;
    let active = true;
    const stop = observePostViews(feedElement.current, async (id) => {
      const { data, error } = await client.rpc('record_livewire_view', { post_id: id });
      if (error) throw error;
      const count = Number(data);
      if (data === null || !Number.isSafeInteger(count) || count < 0) throw new Error('The server returned an invalid post view count.');
      if (!active) return;
      setViewCounts((previous) => ({ ...previous, [id]: Math.max(previous[id] ?? 0, count) }));
      setViewError('');
    }, (cause) => {
      console.error('Could not record LIVEWIRE view', cause);
      setViewError('Some post views could not be recorded. Reconnect or reopen LIVEWIRE to try again.');
    });
    return () => { active = false; stop(); };
  }, []);
  const linkedOutsideFilter = linkedPost && themeFilters.length > 0
    && !themeFilters.some((theme) => linkedPost.themes?.includes(theme));

  useEffect(() => {
    if (!feedElement.current || !onPostSeen) return;
    return observePostViews(feedElement.current, async (id) => {
      await onPostSeen(id);
      setReadError('');
    }, (cause) => {
      console.error('Could not mark LIVEWIRE post as read', cause);
      setReadError('Could not save your read status. Reconnect or reopen LIVEWIRE to retry.');
    }, { minimumRatio: 0.01, bottomInset: 64, allowOffline: !user });
  }, [onPostSeen, user?.id]);

  function filterThemes(next: PostTheme[]) {
    setThemeFilters(next); setLimit(20); setPosts([]); setHasMore(false); setLoaded(false);
  }

  async function act(operation: () => PromiseLike<{ error: { message: string } | null }>, success: () => void) {
    setBusy(true); setActionError(''); setNotice('');
    try {
      const result = await operation();
      if (result.error) { setActionError(result.error.message); return; }
      success();
      setRefresh((value) => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'LIVEWIRE request failed. Please try again.');
    } finally { setBusy(false); }
  }

  return <section className="livewire-panel" aria-labelledby="livewire-heading">
    <header className="livewire-heading"><div><span className="eyebrow">FROM THE GAMEWIRE DESK</span><h2 id="livewire-heading">LIVEWIRE</h2></div><span>{role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'News & takes'}</span></header>
    {(error || accessError) && <p className="livewire-error" role="alert">{error || accessError} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {draftError && <div className="livewire-error" role="alert"><p>{draftError}</p><button type="button" disabled={busy} onClick={() => {
      if (draftRestoreFailed) {
        if ((title || body || photos.length || source || themes.length || editing) && !window.confirm('Retry restoring the saved draft? This replaces the text currently in the editor if restoration succeeds.')) return;
        setDraftRetry((value) => value + 1);
      } else if (user) {
        void saveLivewireDraft(user.id, { title, body, source, themes, editing, photos: photos.map(({ path, file }) => ({ path, file })) })
          .then(() => setDraftError('')).catch((cause: unknown) => { console.error('Could not retry draft saving', cause); setDraftError('Draft saving still failed. Your text remains editable; keep this page open or copy your text before leaving.'); });
      }
    }}>{draftRestoreFailed ? 'Retry restoring draft' : 'Retry saving draft'}</button></div>}
    {role && !draftReady && !draftError && <p role="status">Restoring your saved draft...</p>}
    {role && draftReady && <form className="livewire-composer" onSubmit={(event) => {
      event.preventDefault();
      if (!supabase || busy) return;
      if (source.trim() && !safeNewsLink(source.trim())) { setActionError('Use a valid http or https news link.'); return; }
      void act(savePost, () => {
        resetPhotos(); setThemes([]); setTitle(''); setBody(''); setSource(''); setEditing(null); setDraftRestoreFailed(false); setNotice(editing ? 'Post updated.' : 'Post published.');
      });
    }}>
      <label htmlFor="livewire-title">{editing ? 'Edit subject / title' : 'Subject / title'}</label>
      <input id="livewire-title" maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give your post a headline..." disabled={busy} />
      <fieldset className="livewire-themes" disabled={busy}>
        <legend>Themes <span>(optional, select multiple)</span></legend>
        <div>{postThemes.map((theme) => <label key={theme.value}>
          <input type="checkbox" checked={themes.includes(theme.value)} onChange={(event) => setThemes((current) => event.target.checked
            ? [...current, theme.value] : current.filter((value) => value !== theme.value))} />
          <span className={`wire-primetime-tag tag-${theme.color}`}>{theme.label}</span>
        </label>)}</div>
        <small className="livewire-photo-help">Notification: {themes[0]?.toUpperCase() ?? 'LIVEWIRE'}: {title.trim() || 'Subject of post'}{editing ? ' (edits do not send another notification)' : ''}</small>
      </fieldset>
      <label htmlFor="livewire-body">Post</label>
      <textarea id="livewire-body" maxLength={500} required value={body} onChange={(event) => setBody(event.target.value)} placeholder="Player news, game reactions, and your latest takes..." disabled={busy} />
      <label htmlFor="livewire-source">News link <span>(optional)</span></label>
      <input id="livewire-source" type="url" maxLength={2048} value={source} onChange={(event) => setSource(event.target.value)} placeholder="https://..." disabled={busy} />
      <label htmlFor="livewire-photos">Photos <span>(optional, up to four)</span></label>
      <input id="livewire-photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={busy || photos.length >= 4} onChange={(event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = '';
        if (photos.length + files.length > 4) { setActionError('Attach at most four photos.'); return; }
        if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size)) {
          setActionError('Use JPG, PNG, WebP, or GIF photos up to 5 MB each.'); return;
        }
        setActionError('');
        setPhotos((current) => [...current, ...files.map((file) => {
          const preview = URL.createObjectURL(file); previews.current.add(preview); return { file, preview };
        })]);
      }} />
      <small className="livewire-photo-help">JPG, PNG, WebP or GIF · 5 MB per photo · Photos are public when posted.</small>
      {!!photos.length && <div className="livewire-photo-previews">{photos.map((photo, index) => <div key={photo.preview}><OfflineImage src={photo.preview} alt={`Attachment preview ${index + 1}`} /><button type="button" disabled={busy} onClick={() => {
        if (photo.file) { URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview); }
        setPhotos((current) => current.filter((_, item) => item !== index));
      }}>Remove photo {index + 1}</button></div>)}</div>}
      <div className="livewire-actions"><small>Title {title.length}/120 · Post {body.length}/500</small><button type="button" disabled={busy} onClick={() => { if (window.confirm('Discard this saved draft?')) { resetPhotos(); setThemes([]); setEditing(null); setTitle(''); setBody(''); setSource(''); setDraftRestoreFailed(false); } }}>{editing ? 'Cancel edit' : 'Discard draft'}</button><button className="livewire-publish" disabled={busy || !title.trim() || !body.trim()}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Publish post'}</button></div>
    </form>}
    {actionError && <p className="livewire-error" role="alert">{actionError}</p>}
    {notice && <p className="livewire-notice" role="status">{notice}</p>}
    {postId && linkedReady === postId && linkedMissing && <p className="livewire-notice" role="status">This post is no longer available. You can read the latest LIVEWIRE posts below.</p>}
    <div className="livewire-theme-filters" role="group" aria-label="Filter LIVEWIRE by theme">
      <span>Filter by theme</span>
      <button type="button" aria-pressed={!themeFilters.length} onClick={() => filterThemes([])}>All posts</button>
      {postThemes.map((theme) => <button type="button" key={theme.value} aria-pressed={themeFilters.includes(theme.value)}
        onClick={() => filterThemes(themeFilters.includes(theme.value) ? themeFilters.filter((value) => value !== theme.value) : [...themeFilters, theme.value])}>
        <span className={`wire-primetime-tag tag-${theme.color}`}>{theme.label}</span>
      </button>)}
      <small>Select multiple to show posts with any selected theme.</small>
    </div>
    {linkedOutsideFilter && <p className="livewire-notice">The post opened from your link is shown even though it does not match these filters.</p>}
    {viewError && <p className="livewire-error" role="status">{viewError}</p>}
    {readError && <p className="livewire-error" role="status">{readError}</p>}
    <div className="livewire-feed" ref={feedElement} aria-busy={!loaded && !error}>
      {!loaded && !error && <p>Loading LIVEWIRE...</p>}
      {loaded && !visiblePosts.length && <p className="livewire-empty">{themeFilters.length ? 'No posts match the selected themes. Select another theme or choose All posts.' : 'No posts yet. News and takes from GameWire admins will appear here.'}</p>}
      {visiblePosts.map((post) => <article data-post-id={post.id} className={`livewire-post${post.id === postId ? ' livewire-post-target' : ''}`} key={post.id} ref={post.id === postId ? focusedPost : undefined} tabIndex={post.id === postId ? -1 : undefined} aria-label={post.id === postId ? 'Post opened from notification' : undefined}>
        <span className="livewire-avatar" aria-hidden="true">{post.author_name.split(/\s+/).map((part) => part[0] ?? '').slice(0, 2).join('').toUpperCase()}</span>
        <div className="livewire-post-content">
        <header><b>{post.author_name}</b><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{post.updated_at !== post.created_at ? ' · Edited' : ''}</time>
          {postThemes.filter((theme) => post.themes?.includes(theme.value)).map((theme) => <span className={`wire-primetime-tag tag-${theme.color}`} key={theme.value}>{theme.label}</span>)}
        </header>
        {post.title && <h3>{post.title}</h3>}
        <p>{post.body}</p>
        {(role === 'owner' || role === 'admin') && <span className="livewire-views">{post.view_count === undefined && viewCounts[post.id] === undefined
          ? 'Views unavailable'
          : `${new Intl.NumberFormat().format(Math.max(post.view_count ?? 0, viewCounts[post.id] ?? 0))} ${Math.max(post.view_count ?? 0, viewCounts[post.id] ?? 0) === 1 ? 'view' : 'views'}`}</span>}
        {!!post.image_paths?.length && <div className={`livewire-gallery livewire-gallery-${post.image_paths.length}`}>{post.image_paths.map((path, index) => <button type="button" key={path} onClick={() => setExpandedPhoto({ src: photoUrl(path), alt: `${post.title ?? 'LIVEWIRE post'} - photo ${index + 1}` })} aria-label={`Enlarge photo ${index + 1} for ${post.title ?? 'post'}`}><OfflineImage src={photoUrl(path)} alt={`${post.title ?? 'LIVEWIRE post'} - photo ${index + 1}`} loading="lazy" onError={(event) => { event.currentTarget.alt = 'Photo unavailable'; }} /></button>)}</div>}
        {post.source_url && safeNewsLink(post.source_url) && <a href={safeNewsLink(post.source_url)!} target="_blank" rel="noopener noreferrer">Read source</a>}
        {role && (role === 'owner' || post.author_id === user?.id) && <div className="livewire-actions">
          <button disabled={busy || !draftReady} onClick={() => { if ((draftRestoreFailed || title || body || source || themes.length || photos.length) && !window.confirm('Replace your saved draft with this post?')) return; resetPhotos(); setDraftRestoreFailed(false); setThemes(post.themes ?? []); setPhotos((post.image_paths ?? []).map((path) => ({ path, preview: photoUrl(path) }))); setEditing(post.id); setTitle(post.title ?? ''); setBody(post.body); setSource(post.source_url ?? ''); setActionError(''); }}>Edit</button>
          <button disabled={busy} onClick={() => { if (supabase && window.confirm('Delete this LIVEWIRE post?')) void act(() => supabase!.rpc('delete_livewire_post', { post_id: post.id }), () => {
            if (editing === post.id) { resetPhotos(); setThemes([]); setEditing(null); setTitle(''); setBody(''); setSource(''); }
            setNotice('Post deleted.');
          }); }}>Delete</button>
        </div>}
        </div>
      </article>)}
    </div>
    {hasMore && <button className="livewire-more" onClick={() => setLimit((value) => value + 20)}>Load older posts</button>}
    {role === 'owner' && <details className="livewire-admins"><summary>Manage LIVEWIRE admins</summary><p>Admins can publish posts and manage their own posts. Only you can change admin access or manage everyone’s posts. Verify the person’s account with them before granting access; signup does not verify email ownership.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (supabase && !busy) void act(() => supabase!.rpc('manage_livewire_admin', { account_email: email.trim() }), () => { setEmail(''); setNotice('Admin access granted.'); }); }}>
        <label htmlFor="livewire-admin-email">Existing account email</label><input id="livewire-admin-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /><button disabled={busy}>Grant admin access</button>
      </form>
      <ul>{admins.map((admin) => <li key={admin.user_id}><span>{admin.display_name} · {admin.role}</span>{admin.role === 'admin' && <button disabled={busy} onClick={() => { if (supabase && window.confirm(`Remove admin access for ${admin.display_name}?`)) void act(() => supabase!.rpc('manage_livewire_admin', { remove_user: admin.user_id }), () => setNotice('Admin access removed.')); }}>Remove access</button>}</li>)}</ul>
    </details>}
    {expandedPhoto && <PostPhotoViewer {...expandedPhoto} onClose={() => setExpandedPhoto(null)} />}
  </section>;
}
