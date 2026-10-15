import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './services/supabaseClient';

type Post = { id: string; author_id: string | null; author_name: string; body: string; source_url: string | null; created_at: string; updated_at: string };
type Admin = { user_id: string; role: 'owner' | 'admin'; display_name: string };

function safeNewsLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function LiveWire({ user }: { user: User | null }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [limit, setLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const role = admins.find((admin) => admin.user_id === user?.id)?.role;

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setError('LIVEWIRE is unavailable: account services are not configured.'); return; }
      const client = supabase;
      async function loadPosts() {
        const data: Post[] = [];
        for (let offset = 0; offset <= limit; offset += 500) {
          const page = await client.from('livewire_posts').select('*')
            .order('created_at', { ascending: false }).order('id', { ascending: false })
            .range(offset, Math.min(offset + 499, limit));
          if (page.error) return { data: [], error: page.error };
          data.push(...page.data);
          if (page.data.length < Math.min(500, limit + 1 - offset)) break;
        }
        return { data, error: null };
      }
      const [feed, access] = await Promise.all([
        loadPosts(),
        user ? supabase.from('livewire_roles').select('user_id,role,display_name') : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      if (access.error) setAdmins([]);
      else setAdmins(access.data ?? []);
      if (feed.error || access.error) {
        setError(`Could not refresh LIVEWIRE: ${feed.error?.message ?? access.error?.message}`);
        return;
      }
      setPosts((feed.data ?? []).slice(0, limit));
      setHasMore((feed.data?.length ?? 0) > limit);
      setLoaded(true);
      setError('');
    }
    void load().catch((cause: unknown) => {
      if (active) { setAdmins([]); setError(cause instanceof Error ? cause.message : 'Could not load LIVEWIRE. Please retry.'); }
    });
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, refresh, limit]);

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
    {error && <p className="livewire-error" role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {role && <form className="livewire-composer" onSubmit={(event) => {
      event.preventDefault();
      if (!supabase || busy) return;
      if (source.trim() && !safeNewsLink(source.trim())) { setActionError('Use a valid http or https news link.'); return; }
      void act(() => supabase!.rpc('save_livewire_post', { post_body: body, post_source: source.trim() || null, post_id: editing }), () => {
        setBody(''); setSource(''); setEditing(null); setNotice(editing ? 'Post updated.' : 'Post published.');
      });
    }}>
      <label htmlFor="livewire-body">{editing ? 'Edit post' : 'Create a post'}</label>
      <textarea id="livewire-body" maxLength={500} required value={body} onChange={(event) => setBody(event.target.value)} placeholder="Player news, game reactions, and your latest takes..." disabled={busy} />
      <label htmlFor="livewire-source">News link <span>(optional)</span></label>
      <input id="livewire-source" type="url" maxLength={2048} value={source} onChange={(event) => setSource(event.target.value)} placeholder="https://..." disabled={busy} />
      <div className="livewire-actions"><small>{body.length}/500</small>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setBody(''); setSource(''); }}>Cancel edit</button>}<button className="livewire-publish" disabled={busy || !body.trim()}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Publish post'}</button></div>
    </form>}
    {actionError && <p className="livewire-error" role="alert">{actionError}</p>}
    {notice && <p className="livewire-notice" role="status">{notice}</p>}
    <div className="livewire-feed" aria-busy={!loaded && !error}>
      {!loaded && !error && <p>Loading LIVEWIRE...</p>}
      {loaded && !posts.length && <p className="livewire-empty">No posts yet. News and takes from GameWire admins will appear here.</p>}
      {posts.map((post) => <article className="livewire-post" key={post.id}>
        <header><b>{post.author_name}</b><time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{post.updated_at !== post.created_at ? ' · Edited' : ''}</time></header>
        <p>{post.body}</p>
        {post.source_url && safeNewsLink(post.source_url) && <a href={safeNewsLink(post.source_url)!} target="_blank" rel="noopener noreferrer">Read source</a>}
        {role && (role === 'owner' || post.author_id === user?.id) && <div className="livewire-actions">
          <button disabled={busy} onClick={() => { setEditing(post.id); setBody(post.body); setSource(post.source_url ?? ''); setActionError(''); }}>Edit</button>
          <button disabled={busy} onClick={() => { if (supabase && window.confirm('Delete this LIVEWIRE post?')) void act(() => supabase!.rpc('delete_livewire_post', { post_id: post.id }), () => {
            if (editing === post.id) { setEditing(null); setBody(''); setSource(''); }
            setNotice('Post deleted.');
          }); }}>Delete</button>
        </div>}
      </article>)}
    </div>
    {hasMore && <button className="livewire-more" onClick={() => setLimit((value) => value + 20)}>Load older posts</button>}
    {role === 'owner' && <details className="livewire-admins"><summary>Manage LIVEWIRE admins</summary><p>Admins can publish posts and manage their own posts. Only you can change admin access or manage everyone’s posts. Verify the person’s account with them before granting access; signup does not verify email ownership.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (supabase && !busy) void act(() => supabase!.rpc('manage_livewire_admin', { account_email: email.trim() }), () => { setEmail(''); setNotice('Admin access granted.'); }); }}>
        <label htmlFor="livewire-admin-email">Existing account email</label><input id="livewire-admin-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /><button disabled={busy}>Grant admin access</button>
      </form>
      <ul>{admins.map((admin) => <li key={admin.user_id}><span>{admin.display_name} · {admin.role}</span>{admin.role === 'admin' && <button disabled={busy} onClick={() => { if (supabase && window.confirm(`Remove admin access for ${admin.display_name}?`)) void act(() => supabase!.rpc('manage_livewire_admin', { remove_user: admin.user_id }), () => setNotice('Admin access removed.')); }}>Remove access</button>}</li>)}</ul>
    </details>}
  </section>;
}
