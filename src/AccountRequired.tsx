import type { ReactNode } from 'react';

export default function AccountRequired({ hasAccount, section, online, onSignIn, children }: {
  hasAccount: boolean;
  section: 'Analyst Desk' | 'GamewAIre' | null;
  online: boolean;
  onSignIn: () => void;
  children: ReactNode;
}) {
  if (hasAccount) return children;
  if (!section) return null;
  return <section className="account-required" aria-labelledby="account-required-heading">
    <span className="eyebrow">ACCOUNT REQUIRED</span>
    <h2 id="account-required-heading">Sign in to access {section}</h2>
    <p>{section} is available to GameWire members. Sign in or create an account to view this area.</p>
    {!online && <p role="status">Reconnect to the internet to sign in or create an account.</p>}
    <button type="button" className="auth-submit" disabled={!online} onClick={onSignIn}>Sign in or create an account</button>
  </section>;
}
