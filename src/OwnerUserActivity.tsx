import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { RefreshCw, Search, Users } from 'lucide-react';
import { supabase } from './services/supabaseClient';

type UserActivity = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  joined_at: string;
  last_sign_in_at: string | null;
  open_count: number;
  last_opened_at: string | null;
  notification_devices: number;
  score_alert_devices: number;
};
type GuestActivity = { sessions: number; total_opens: number; active_week: number; last_opened_at: string | null };

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return dateFormat.format(new Date(value));
}

function formatLastOpened(value: string | null, now: number) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Never';
  const elapsed = now - Date.parse(value);
  if (elapsed < 60 * 1000) return 'Just now';
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / 60000)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / 3600000)}h ago`;
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return formatDate(value);
}

export default function OwnerUserActivity({ user }: { user: User }) {
  const [isOwner, setIsOwner] = useState(false);
  const [rows, setRows] = useState<UserActivity[] | null>(null);
  const [guests, setGuests] = useState<GuestActivity | null>(null);
  const [guestError, setGuestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void Promise.resolve(supabase.from('livewire_roles').select('role').eq('user_id', user.id).maybeSingle()).then(({ data }) => {
      if (active) setIsOwner(data?.role === 'owner');
    });
    return () => { active = false; };
  }, [user.id]);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase.rpc('owner_user_activity');
      if (loadError) setError('Could not load registered users. Try again.');
      else { setRows((data ?? []) as UserActivity[]); setNow(Date.now()); }
      const { data: guestData, error: guestLoadError } = await supabase.rpc('owner_guest_activity');
      if (guestLoadError) setGuestError('Could not load guest visits. Try refreshing.');
      else {
        const row = guestData?.[0];
        if (!row || !['sessions', 'total_opens', 'active_week'].every((key) => Number.isFinite(Number(row[key])) && Number(row[key]) >= 0)
          || (row.last_opened_at !== null && (typeof row.last_opened_at !== 'string' || !Number.isFinite(Date.parse(row.last_opened_at))))) {
          setGuestError('The server returned invalid guest activity. Try refreshing.');
        } else {
          setGuests({ sessions: Number(row.sessions), total_opens: Number(row.total_opens), active_week: Number(row.active_week), last_opened_at: row.last_opened_at });
          setGuestError('');
        }
      }
    } catch (cause) {
      console.error('Could not refresh owner visit activity', cause);
      setError('Could not refresh visit activity. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOwner) void load(); }, [isOwner, load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!rows || !term) return rows ?? [];
    return rows.filter((row) => `${row.display_name ?? ''} ${row.email ?? ''}`.toLowerCase().includes(term));
  }, [rows, query]);

  if (!isOwner) return null;

  const totalOpens = rows?.reduce((sum, row) => sum + Number(row.open_count), 0) ?? 0;
  const activeWeek = rows?.filter((row) => row.last_opened_at && now - Date.parse(row.last_opened_at) < 7 * DAY_MS).length ?? 0;

  return <section className="account-setting owner-users" aria-labelledby="owner-users-title">
    <header>
      <Users size={16} />
      <div><b id="owner-users-title">Registered users</b><small>Only visible to you</small></div>
      <button type="button" className="owner-users-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh registered users"><RefreshCw size={14} className={loading ? 'spinning' : undefined} /></button>
    </header>
    <div className="owner-users-stats">
      <span><b>{rows?.length ?? '—'}</b><small>ACCOUNTS</small></span>
      <span><b>{rows ? totalOpens.toLocaleString() : '—'}</b><small>TOTAL OPENS</small></span>
      <span><b>{rows ? activeWeek : '—'}</b><small>ACTIVE 7 DAYS</small></span>
    </div>
    <label className="owner-users-search"><Search size={14} /><input type="search" placeholder="Search name or email" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search registered users" /></label>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!rows && loading && <p className="owner-users-empty">Loading users…</p>}
    {rows && filtered.length === 0 && <p className="owner-users-empty">No users match “{query}”.</p>}
    {filtered.length > 0 && <ol className="owner-users-list">
      <li className="owner-users-head" aria-hidden="true"><span>USER / NOTIFICATIONS</span><span>OPENS</span><span>LAST OPENED</span><span>JOINED</span></li>
      {filtered.map((row) => <li key={row.user_id}>
        <span className="owner-users-identity">
          <b>{row.display_name || row.email || 'Unknown user'}</b>{row.display_name && row.email && <small>{row.email}</small>}
          <span className="owner-users-notifications">{row.notification_devices > 0
            ? `Push registered: ${row.notification_devices} ${Number(row.notification_devices) === 1 ? 'device' : 'devices'}`
            : 'No push devices registered'}</span>
          <span className="owner-users-notifications">Score alerts: {row.score_alert_devices > 0
            ? `on for ${row.score_alert_devices} ${Number(row.score_alert_devices) === 1 ? 'device' : 'devices'}`
            : 'off'}</span>
        </span>
        <span className="owner-users-opens" aria-label={row.user_id === user.id ? 'Your opens are excluded' : `${row.open_count} opens`}>{row.user_id === user.id ? 'Excluded' : Number(row.open_count).toLocaleString()}</span>
        <span className="owner-users-last"><small>Last opened </small>{row.user_id === user.id ? 'Not tracked' : formatLastOpened(row.last_opened_at, now)}</span>
        <span className="owner-users-joined"><small>Joined </small>{formatDate(row.joined_at)}</span>
      </li>)}
    </ol>}
    <h3>Guest visits</h3>
    <div className="owner-users-stats" aria-label="Guest activity">
      <span><b>{guests ? guests.sessions.toLocaleString() : '—'}</b><small>GUEST SESSIONS</small></span>
      <span><b>{guests ? guests.total_opens.toLocaleString() : '—'}</b><small>GUEST OPENS</small></span>
      <span><b>{guests ? guests.active_week.toLocaleString() : '—'}</b><small>ACTIVE 7 DAYS</small></span>
    </div>
    {guestError && <p className="auth-error" role="alert">{guestError}</p>}
    {guests && <p className="owner-users-note">Last guest open: {formatLastOpened(guests.last_opened_at, now)}.</p>}
    <p className="owner-users-note">Account totals above cover signed-in visits starting Oct 19, 2026; your owner account is excluded. Guest totals are separate and start Oct 23, 2026. Guests are anonymous browser/app sessions, not unique people; no names or emails are collected. Returning after 30+ minutes in the background counts another open. Signed-out owner visits cannot be distinguished from other guests.</p>
    <p className="owner-users-note">Notification status reflects saved push subscriptions, not current phone permissions. A user may have muted notifications in device settings. Angle and LIVEWIRE alerts go to registered push devices even when score alerts are off.</p>
  </section>;
}
