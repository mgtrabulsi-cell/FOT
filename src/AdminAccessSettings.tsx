import { useEffect, useState } from 'react';
import { supabase } from './services/supabaseClient';

export default function AdminAccessSettings({ userId }: { userId: string }) {
  const [admins, setAdmins] = useState<{ user_id: string; role: string; display_name: string }[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void Promise.resolve(supabase.from('livewire_roles').select('user_id,role,display_name')).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('Could not reload admin access. Retry before making another change.');
      else { setAdmins(data ?? []); setError(''); }
    }, () => { if (active) setError('Could not reload admin access. Retry before making another change.'); });
    return () => { active = false; };
  }, [userId, retry]);
  if (!admins.some(admin => admin.user_id === userId && admin.role === 'owner')) return null;
  const manage = async (parameters: { account_email: string } | { remove_user: string }) => {
    if (!supabase || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { error } = await supabase.rpc('manage_livewire_admin', parameters);
      if (error) throw error;
      setEmail(''); setNotice('Admin access updated.'); setRetry(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update admin access.');
    } finally { setBusy(false); }
  };
  return <section className="account-setting"><details className="livewire-admins">
    <summary>Manage GameWire admins</summary>
    <p>Admin access is shared across Analyst Desk and GamewAIre. Only the owner can grant or remove it. Verify the account holder before granting access; signup does not verify email ownership.</p>
    <form onSubmit={event => { event.preventDefault(); void manage({ account_email: email.trim() }); }}>
      <label htmlFor="profile-admin-email">Existing account email</label>
      <input id="profile-admin-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      <button disabled={busy}>Grant admin access</button>
    </form>
    <ul>{admins.map(admin => <li key={admin.user_id}><span>{admin.display_name} · {admin.role}</span>{admin.role === 'admin' && <button disabled={busy} onClick={() => {
      if (window.confirm(`Remove admin access for ${admin.display_name}?`)) void manage({ remove_user: admin.user_id });
    }}>Remove access</button>}</li>)}</ul>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setRetry(value => value + 1)}>Retry</button></p>}
  </details></section>;
}
