import { useEffect, useState } from 'react';
import { supabase } from './services/supabaseClient';

export function useSimulationGraphicAccess() {
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true, revision = 0;
    const check = async () => {
      const current = ++revision;
      setError('');
      try {
        const session = await client.auth.getSession();
        if (session.error) throw session.error;
        if (!active || current !== revision) return;
        if (!session.data.session?.user) { setAllowed(false); return; }
        const result = await client.from('livewire_roles').select('role').eq('user_id', session.data.session.user.id).maybeSingle();
        if (result.error) throw result.error;
        if (active && current === revision) setAllowed(result.data?.role === 'owner' || result.data?.role === 'admin');
      } catch (cause) {
        if (!active || current !== revision) return;
        setAllowed(false);
        console.error('Could not verify simulation graphic permissions', cause);
        setError('Could not verify simulation graphic permissions. Reconnect or sign in again to retry.');
      }
    };
    const refresh = () => { if (active) void check(); };
    refresh();
    const { data } = client.auth.onAuthStateChange(() => {
      ++revision; setAllowed(false); setError('');
      window.setTimeout(refresh, 0);
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      active = false; ++revision;
      data.subscription.unsubscribe();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);
  return { allowed, error };
}
