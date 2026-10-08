export default function SplashScreen() {
  const base = import.meta.env.BASE_URL;
  return <main className="splash-screen" aria-label="GameWire is loading" aria-live="polite">
    <div className="splash-logo">
      <img className="splash-base" src={`${base}gamewire-mark.png`} alt="GameWire" />
      <img className="splash-pulse splash-pulse-glow" src={`${base}gamewire-pulse.png`} alt="" aria-hidden="true" />
      <img className="splash-pulse splash-pulse-sweep" src={`${base}gamewire-pulse.png`} alt="" aria-hidden="true" />
    </div>
  </main>;
}
