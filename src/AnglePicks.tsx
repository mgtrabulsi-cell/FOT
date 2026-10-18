import { Check, X } from 'lucide-react';
import type { AnglePick } from './services/theAngle';

export function PickResult({ result }: { result: AnglePick['result'] }) {
  return <span className={`pick-result pick-result-${result}`}>{result === 'hit' ? <Check size={18} aria-hidden="true" /> : result === 'miss' ? <X size={18} aria-hidden="true" /> : null}{result === 'hit' ? 'Hit' : result === 'miss' ? 'Missed' : 'Pending'}</span>;
}

export default function AnglePicks({ picks }: { picks: AnglePick[] }) {
  return <>{picks.map((pick) => <div className="angle-pick" key={pick.id}><h4>Admin pick · Opinion</h4><p>{pick.text}</p><PickResult result={pick.result} /></div>)}</>;
}
