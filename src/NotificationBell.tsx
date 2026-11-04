import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { enablePushNotifications, supportsPushNotifications } from './services/pushNotifications';

export default function NotificationBell() {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function enable() {
    if (busy) return;
    setBusy(true); setMessage(''); setError(false);
    try {
      if (!supportsPushNotifications()) throw new Error('On iPhone or iPad, add GameWire to your Home Screen and open it there to enable notifications. Use a supported browser on other devices.');
      // Start the permission request within the click gesture, before account lookup.
      const permission = Notification.requestPermission();
      const result = await permission;
      if (result !== 'granted') throw new Error('Allow notifications in your device or browser settings, then try again.');
      if (!supabase) throw new Error('Account services are unavailable.');
      const { data, error: accountError } = await supabase.auth.getSession();
      if (accountError) throw accountError;
      if (!data.session) throw new Error('Sign in to enable notifications for your posts and favorites.');
      await enablePushNotifications(data.session.user.id, true);
      setEnabled(true);
      setMessage('Notifications enabled on this device for new posts and score updates for your favorites. Player updates are included when shared in posts.');
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : 'Could not enable notifications. Please retry.');
    } finally { setBusy(false); }
  }
  return <div className="notification-bell-control">
    <button type="button" className="notification-bell" disabled={busy} aria-label={enabled ? 'Notifications enabled; enable all alerts again' : 'Turn on notifications for posts and favorites'} title="Enable notifications for posts and favorites" onClick={(event) => { event.stopPropagation(); void enable(); }}>
      {enabled ? <Check size={17} aria-hidden="true" /> : <Bell size={17} aria-hidden="true" />}
    </button>
    {message && <div className="notification-bell-message" role={error ? 'alert' : 'status'}>
      <p>{message}</p><button type="button" onClick={(event) => { event.stopPropagation(); setMessage(''); }}>Dismiss</button>
    </div>}
  </div>;
}
