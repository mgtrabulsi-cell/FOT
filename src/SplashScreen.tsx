import { useEffect, useState } from 'react';

export default function SplashScreen({ onContinueGuest }: { onContinueGuest: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      console.warn('Sign-in session restoration is taking longer than expected.');
      setSlow(true);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, []);
  const base = import.meta.env.BASE_URL;
  return <main className="splash-screen" aria-label="GameWire is loading" aria-live="polite">
    <div className="splash-logo">
      <img className="splash-base" src={`${base}gamewire-mark.png`} alt="GameWire" />
      <img className="splash-pulse splash-pulse-glow" src={`${base}gamewire-pulse.png`} alt="" aria-hidden="true" />
      <img className="splash-pulse splash-pulse-sweep" src={`${base}gamewire-pulse.png`} alt="" aria-hidden="true" />
    </div>
    {slow && <section className="splash-recovery" aria-label="Sign-in connection recovery">
      <h1>Sign-in is taking longer than expected</h1>
      <p>The account service may be temporarily unavailable. You can keep waiting or browse as a guest. Your saved account data is not deleted.</p>
      <button type="button" onClick={onContinueGuest}>Continue as guest</button>
    </section>}
  </main>;
}
