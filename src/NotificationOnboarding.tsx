import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './services/supabaseClient';
import { enablePushNotifications, hasPushConfiguration, supportsPushNotifications } from './services/pushNotifications';

export default function NotificationOnboarding({ user }: { user: User }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const available = supportsPushNotifications() && hasPushConfiguration();
  const pending = user.user_metadata.notification_onboarding_pending === true && !done;

  useEffect(() => {
    const element = dialog.current;
    if (pending && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [pending]);

  async function finish(turnOn: boolean) {
    setBusy(true); setError('');
    try {
      if (!supabase) throw new Error('Account services are unavailable.');
      if (turnOn && !enabled) {
        await enablePushNotifications(user.id, true);
        setEnabled(true);
      }
      const { error: saveError } = await supabase.auth.updateUser({ data: { notification_onboarding_pending: false } });
      if (saveError) throw saveError;
      setDone(true);
    } catch (cause) {
      console.error('Could not finish notification onboarding', cause);
      setError(cause instanceof Error ? cause.message : 'Could not save your notification choice. Please retry.');
    } finally { setBusy(false); }
  }

  if (!pending) return null;
  return <dialog ref={dialog} className="notification-onboarding" aria-labelledby="notification-welcome-title" aria-describedby="notification-welcome-description" onCancel={(event) => {
    event.preventDefault();
    if (!busy) void finish(false);
  }}>
    <h2 id="notification-welcome-title">Turn on GameWire notifications</h2>
    <p id="notification-welcome-description">We recommend turning on all available notifications so you can keep up with new posts, score updates, player updates, and more.</p>
    <ul className="notification-benefits">
      <li><strong>Posts:</strong> new Angle posts and published picks.</li>
      <li><strong>Scores:</strong> favorite NFL game updates, favorite NBA team quarter scores, scoring milestones, and buzzer-beaters.</li>
      <li><strong>Players:</strong> player news and updates shared in posts.</li>
    </ul>
    {available && <p>Tap Turn on notifications below, then choose Allow when your device asks. Score alerts will be enabled too.</p>}
    {!available && <p>Notifications are not available in this app or browser right now. On supported iPhones and iPads, add GameWire to your Home Screen and open it there. You can enable notifications later in your Profile on a supported device.</p>}
    {enabled && <p role="status">Notifications are enabled. Save your choice below to finish.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="angle-actions">
      <button type="button" className="auth-submit" disabled={busy || !available} onClick={() => void finish(true)}>{busy ? 'Please wait...' : enabled ? 'Finish setup' : 'Turn on notifications'}</button>
      <button type="button" disabled={busy} onClick={() => void finish(false)}>{available ? 'Not now' : 'Continue'}</button>
    </div>
    <p>You can change notification settings in your Profile at any time.</p>
  </dialog>;
}
