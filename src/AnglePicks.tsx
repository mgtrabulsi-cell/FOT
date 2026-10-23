import { Check, X } from 'lucide-react';
import type { AnglePick } from './services/theAngle';
import { pickCategory, pickCategoryLabels } from './services/anglePicks';

export function PickResult({ result }: { result: AnglePick['result'] }) {
  if (result === 'pending') return null;
  return <span className={`pick-result pick-result-${result}`} role="img" aria-label={result === 'hit' ? 'Hit' : 'Missed'}>{result === 'hit' ? <Check size={22} aria-hidden="true" /> : <X size={22} aria-hidden="true" />}</span>;
}

export default function AnglePicks({ picks, emoji }: { picks: AnglePick[]; emoji?: string }) {
  return <>{picks.map((pick) => <div className={`angle-pick angle-pick-${pick.result}`} key={pick.id}><div className="angle-pick-heading"><h4>{emoji && <span className="angle-sport-emoji" aria-hidden="true">{emoji}</span>}Admin pick · {pickCategoryLabels[pickCategory(pick)]} · Opinion</h4><PickResult result={pick.result} /></div><p>{pick.text}</p></div>)}</>;
}
