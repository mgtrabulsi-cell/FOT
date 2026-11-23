export type PropSequence = {
  games: number; last5: { hits: number; games: number }; last10: { hits: number; games: number };
  streak: { outcome: 'hit' | 'miss'; games: number } | null;
  pattern: string; matchingGames: number; matchingHits: number;
  active: boolean; adjustment: number; validationGames: number; baselineError: number | null; adjustedError: number | null;
};
const clamp = (value: number) => Math.max(-.03, Math.min(.03, value));
export function propSequence(samples: Array<{ eventId?: string; date: string; value: number }>, line: number, under = false): PropSequence {
  const seen = new Set<string>();
  const outcomes = [...samples].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).flatMap(row => {
    const id = row.eventId ?? row.date;
    if (seen.has(id) || !Number.isFinite(row.value) || !Number.isFinite(Date.parse(row.date))) return [];
    seen.add(id);
    if (row.value === line) return [];
    return [under ? Number(row.value < line) : Number(row.value > line)];
  });
  const recent = (count: number) => { const rows = outcomes.slice(-count); return { hits: rows.reduce((a, b) => a + b, 0), games: rows.length }; };
  const latest = outcomes.at(-1);
  let run = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === latest; i--) run++;
  const streak = latest === undefined ? null : { outcome: latest ? 'hit' as const : 'miss' as const, games: run };
  const patternAt = (index: number) => outcomes.slice(index - 2, index).join(',');
  const pattern = outcomes.length >= 2 ? patternAt(outcomes.length) : '';
  const result: PropSequence = { games: outcomes.length, last5: recent(5), last10: recent(10), streak,
    pattern: pattern ? pattern.split(',').map(value => value === '1' ? 'hit' : 'miss').join(' then ') : 'Insufficient history',
    matchingGames: 0, matchingHits: 0, active: false, adjustment: 0, validationGames: 0, baselineError: null, adjustedError: null };
  for (let i = 2; i < outcomes.length; i++) if (patternAt(i) === pattern) {
    result.matchingGames++; result.matchingHits += outcomes[i];
  }
  if (outcomes.length < 64 || !Number.isFinite(line)) return result;
  const split = Math.floor(outcomes.length * .75), training = outcomes.slice(0, split);
  if (!training.includes(0) || !training.includes(1)) return result;
  const baseline = (training.reduce((a, b) => a + b, 0) + 2) / (training.length + 4);
  const groups = new Map<string, { hits: number; games: number }>();
  for (let i = 2; i < split; i++) {
    const key = patternAt(i), group = groups.get(key) ?? { hits: 0, games: 0 };
    group.games++; group.hits += outcomes[i]; groups.set(key, group);
  }
  const delta = (key: string) => {
    const group = groups.get(key);
    return group && group.games >= 8 ? clamp((group.hits + baseline * 8) / (group.games + 8) - baseline) : 0;
  };
  const current = groups.get(pattern);
  if (!current || current.games < 8) return result;
  let baselineError = 0, adjustedError = 0, baselineLog = 0, adjustedLog = 0;
  let sameCount = 0, sameBase = 0, sameAdjusted = 0, supported = 0;
  for (let i = split; i < outcomes.length; i++) {
    const key = patternAt(i), p = baseline + delta(key), actual = outcomes[i];
    const baseError = (baseline - actual) ** 2, error = (p - actual) ** 2;
    baselineError += baseError; adjustedError += error;
    baselineLog -= actual * Math.log(baseline) + (1 - actual) * Math.log(1 - baseline);
    adjustedLog -= actual * Math.log(p) + (1 - actual) * Math.log(1 - p);
    if ((groups.get(key)?.games ?? 0) >= 8) supported++;
    if (key === pattern) { sameCount++; sameBase += baseError; sameAdjusted += error; }
  }
  const count = outcomes.length - split;
  result.validationGames = count; result.baselineError = baselineError / count; result.adjustedError = adjustedError / count;
  result.active = supported >= 12 && sameCount >= 4 && sameAdjusted < sameBase
    && adjustedError <= baselineError * .98 && adjustedLog <= baselineLog && Math.abs(delta(pattern)) > 1e-8;
  if (result.active) result.adjustment = delta(pattern);
  return result;
}
