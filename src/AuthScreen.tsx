import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LogIn, UserPlus } from 'lucide-react';
import { supabase } from './services/supabaseClient';
import { getRememberDevice, setRememberDevice } from './services/authStorage';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remember, setRemember] = useState(getRememberDevice);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNotice('');
    setRememberDevice(remember);
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (authError) throw authError;
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-panel">
      <div className="auth-brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}gamewire-mark.png`} alt="" /><span>GAMEWIRE</span></div>
      {!supabase ? <>
        <span className="eyebrow">ACCOUNT SETUP</span>
        <h1>Connect your Supabase project</h1>
        <p className="auth-description">Add your project URL and publishable key to <code>.env.local</code>, then run <code>supabase/schema.sql</code> in the Supabase SQL editor to enable accounts and private favorites.</p>
        <div className="auth-config-note">Only a publishable or legacy anon key belongs in the browser. Never use a secret or service-role key here.</div>
      </> : <>
        <span className="eyebrow">NFL · GAMEWIRE</span>
        <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-description">{mode === 'signup' ? 'Save your NFL favorites to your own account.' : 'Sign in to access your saved favorites.'}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={60} /></label>}
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password
            <span className="password-field">
              <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <label className="auth-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember this device</span></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>{mode === 'signup' ? <UserPlus size={16} /> : <LogIn size={16} />}{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        </form>
        <button className="auth-mode-toggle" type="button" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); setNotice(''); }}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New to GameWire? Create an account'}</button>
      </>}
    </section>
  </main>;
}
