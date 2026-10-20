import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Roll = { values: number[]; key: number };

const MAX_REEL_STEPS = 8;
const ROLL_MS = 2_500;
const SPARKS = Array.from({ length: 18 }, (_, index) => index);

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

// Rolls a score upward like a slot wheel and fires a small burst when it increases. `gameKey` resets the
// baseline so switching to a different game never looks like a score.
export function ScoreTicker({ value, gameKey }: { value: number | string; gameKey: string }) {
  const previous = useRef({ value, gameKey });
  const [roll, setRoll] = useState<Roll | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { value, gameKey };
    const from = Number(before.value);
    const to = Number(value);
    if (before.gameKey !== gameKey || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || prefersReducedMotion()) {
      setRoll(null);
      return;
    }
    const steps = Array.from({ length: Math.min(to - from, MAX_REEL_STEPS) }, (_, index) => to - index).reverse();
    setRoll({ values: [from, ...steps], key: Date.now() });
    const timer = window.setTimeout(() => setRoll(null), ROLL_MS);
    return () => window.clearTimeout(timer);
  }, [value, gameKey]);

  if (!roll) return <>{value}</>;
  return (
    <span className="score-ticker" key={roll.key}>
      <span className="score-ticker-sr">{value}</span>
      <span className="score-ticker-window" aria-hidden="true">
        <span className="score-ticker-reel" style={{ '--score-roll-steps': roll.values.length - 1 } as CSSProperties}>
          {roll.values.map((item, index) => <span key={index}>{item}</span>)}
        </span>
      </span>
      <span className="score-fireworks" aria-hidden="true">
        {SPARKS.map((spark) => <i key={spark} style={{ '--spark-angle': `${(360 / SPARKS.length) * spark}deg`, '--spark-index': spark } as CSSProperties} />)}
      </span>
    </span>
  );
}
