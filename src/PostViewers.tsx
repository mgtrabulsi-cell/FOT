import { useState } from 'react';
import { supabase } from './services/supabaseClient';

type Viewer = { user_id: string; display_name: string; views: number; last_viewed_at: string };
type ViewerSummary = { viewers: Viewer[]; guest_views: number; unattributed_views: number };

export function readPostViewers(value: unknown): ViewerSummary {
  const count = (entry: unknown): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0;
  if (!value || typeof value !== 'object' || !('viewers' in value) || !Array.isArray(value.viewers)
    || !('guest_views' in value) || !count(value.guest_views)
    || !('unattributed_views' in value) || !count(value.unattributed_views)
    || !value.viewers.every((row): row is Viewer => row && typeof row.user_id === 'string'
      && typeof row.display_name === 'string' && count(row.views)
      && typeof row.last_viewed_at === 'string' && Number.isFinite(Date.parse(row.last_viewed_at)))) {
    throw new Error('The server returned invalid viewer details.');
  }
  return { viewers: value.viewers, guest_views: value.guest_views, unattributed_views: value.unattributed_views };
}

export default function PostViewers({ surface, postId, count }: { surface: 'angle' | 'livewire'; postId: string; count: number | undefined }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ViewerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      if (!supabase) throw new Error('Account services are not configured.');
      const result = await supabase.rpc('admin_post_viewers', { post_surface: surface, target_post: postId });
      if (result.error) throw result.error;
      setData(readPostViewers(result.data));
    } catch (cause) {
      console.error('Could not load post viewers', cause);
      setError('Could not load viewers. Please retry.');
    } finally { setLoading(false); }
  }
  return <div className="post-viewers">
    <button type="button" className="livewire-views" aria-expanded={open} onClick={() => {
      setOpen(!open);
      if (!open) void load();
    }}>{count === undefined ? 'Views unavailable' : `${count.toLocaleString()} ${count === 1 ? 'view' : 'views'}`}</button>
    {open && <section className="post-viewers-panel" aria-label="Post viewers">
      <h4>Who viewed this post</h4>
      {loading && <p role="status">Loading viewers...</p>}
      {error && <p role="alert">{error} <button type="button" disabled={loading} onClick={() => void load()}>Retry</button></p>}
      {data && <>
        <ul>{data.viewers.map((viewer) => <li key={viewer.user_id}><strong>{viewer.display_name}</strong> · {viewer.views.toLocaleString()} {viewer.views === 1 ? 'view' : 'views'} · Last viewed {new Date(viewer.last_viewed_at).toLocaleString()}</li>)}</ul>
        {!data.viewers.length && <p>No identified signed-in viewers recorded yet.</p>}
        <p>Anonymous guest views: {data.guest_views.toLocaleString()}</p>
        <p>Earlier/unattributed views: {data.unattributed_views.toLocaleString()}</p>
      </>}
      <p>Identities are available only for views recorded since this feature launched. Counts are impressions, not unique people. Signed-in owner views are excluded.</p>
    </section>}
  </div>;
}
