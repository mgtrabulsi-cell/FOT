import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { ArrowLeft, Bell, CalendarDays, KeyRound, Mail } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { disablePushNotifications, enablePushNotifications, getPushSettings, hasPushConfiguration, sendTestPushNotification, supportsPushNotifications, updatePushPreference } from './services/pushNotifications';

function PushNotificationSettings({ user }: { user: User }) {
  const [supported, setSupported] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [notifyScores, setNotifyScores] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const pushSupported = supportsPushNotifications();
    setSupported(pushSupported);
    setConfigured(hasPushConfiguration());
    if (!pushSupported) {
      setChecking(false);
      return () => { active = false; };
    }

    setChecking(true);
    void getPushSettings(user.id).then((settings) => {
      if (!active) return;
      setEnabled(settings.enabled);
      setNotifyScores(settings.notifyScores);
      setError('');
    }).catch(() => {
      if (active) setError('Could not load this device’s notification settings.');
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, [user.id]);

  const enable = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await enablePushNotifications(user.id, notifyScores);
      setEnabled(true);
      setMessage('Notifications are enabled on this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await disablePushNotifications(user.id);
      setEnabled(false);
      setMessage('Notifications are turned off on this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not turn off notifications.');
    } finally {
      setBusy(false);
    }
  };

  const updatePreference = async (nextValue: boolean) => {
    const previousValue = notifyScores;
    setNotifyScores(nextValue);
    setError('');
    try {
      await updatePushPreference(user.id, nextValue);
    } catch (cause) {
      setNotifyScores(previousValue);
      setError(cause instanceof Error ? cause.message : 'Could not save this preference.');
    }
  };

  const sendTest = async () => {
    setTestBusy(true);
    setError('');
    setMessage('');
    try {
      await sendTestPushNotification();
      setMessage('A test notification was sent to this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send a test notification.');
    } finally {
      setTestBusy(false);
    }
  };

  return <section className="account-setting push-notifications-setting"><header><Bell size={16} /><div><b>Mobile notifications</b><small>Game updates for teams and players you follow.</small></div></header><div className="account-setting-form push-settings-form">
    {!supported ? <p className="nfl-empty-note">This browser does not support push notifications.</p> : !configured ? <p className="auth-config-note">Push is not configured for this site yet.</p> : checking ? <p className="nfl-empty-note">Checking this device…</p> : enabled ? <>
      <label className="push-preference"><input type="checkbox" checked={notifyScores} onChange={(event) => void updatePreference(event.target.checked)} />Favorite game score and status changes</label>
      <div className="push-actions"><button type="button" onClick={() => void sendTest()} disabled={testBusy}>{testBusy ? 'Sending…' : 'Send test notification'}</button><button type="button" className="push-disable-button" onClick={() => void disable()} disabled={busy}>{busy ? 'Updating…' : 'Turn off on this device'}</button></div>
    </> : <button type="button" onClick={() => void enable()} disabled={busy}>{busy ? 'Enabling…' : 'Enable on this device'}</button>}
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-notice" role="status">{message}</p>}
  </div></section>;
}

export default function ProfilePage({ user, onBack }: { user: User; onBack: () => void }) {
  const currentEmail = user.email ?? '';
  const displayName = typeof user.user_metadata.display_name === 'string' && user.user_metadata.display_name.trim()
    ? user.user_metadata.display_name.trim()
    : currentEmail || 'GameWire member';
  const [email, setEmail] = useState(currentEmail);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const joinedAt = user.created_at && !Number.isNaN(Date.parse(user.created_at))
    ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(user.created_at))
    : 'Unavailable';

  const updateEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const nextEmail = email.trim();
    if (nextEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setEmailError('Enter a different email address.');
      setEmailMessage('');
      return;
    }
    setEmailBusy(true);
    setEmailError('');
    setEmailMessage('');
    const { error } = await supabase.auth.updateUser({ email: nextEmail });
    if (error) setEmailError(error.message);
    else setEmailMessage('Check your inbox to confirm the email change.');
    setEmailBusy(false);
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword !== confirmPassword) {
      setPasswordError('The passwords do not match.');
      setPasswordMessage('');
      return;
    }
    setPasswordBusy(true);
    setPasswordError('');
    setPasswordMessage('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setPasswordError(error.message);
    else {
      setPasswordMessage('Your password has been updated.');
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordBusy(false);
  };

  return <section className="account-profile">
    <header className="account-profile-heading"><div><span className="eyebrow">ACCOUNT</span><h2>Profile</h2></div><button className="account-back-button" onClick={onBack}><ArrowLeft size={15} />Back to GameWire</button></header>
    <section className="account-profile-summary"><span className="account-profile-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="account-profile-identity"><b>{displayName}</b><small>{currentEmail}</small></span><span className="account-joined"><CalendarDays size={15} /><span><small>JOINED</small><b>{joinedAt}</b></span></span></section>
    <div className="account-settings-grid">
      <PushNotificationSettings user={user} />
      <section className="account-setting"><header><Mail size={16} /><div><b>Email address</b><small>Update the address used to sign in.</small></div></header><form className="account-setting-form" onSubmit={updateEmail}><label>New email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{emailError && <p className="auth-error" role="alert">{emailError}</p>}{emailMessage && <p className="auth-notice" role="status">{emailMessage}</p>}<button type="submit" disabled={emailBusy}>{emailBusy ? 'Sending confirmation…' : 'Change email'}</button></form></section>
      <section className="account-setting"><header><KeyRound size={16} /><div><b>Password</b><small>Choose a new password for your account.</small></div></header><form className="account-setting-form" onSubmit={updatePassword}><label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} /></label>{passwordError && <p className="auth-error" role="alert">{passwordError}</p>}{passwordMessage && <p className="auth-notice" role="status">{passwordMessage}</p>}<button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Change password'}</button></form></section>
    </div>
  </section>;
}
