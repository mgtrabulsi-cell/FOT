export type Sport = 'NFL' | 'NBA';
export const modelVersion = 'empirical-baseline-v1';
export const markets = {
  NBA: ['h2h', 'spreads', 'totals', 'player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  NFL: ['h2h', 'spreads', 'totals', 'player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions'],
} as const;
export type Settings = {
  markets: string[]; direction: 'both' | 'over' | 'under'; player: string;
  minEV: number; minEdge: number; minQuality: number; recentWeight: number;
};
export const defaultSettings: Settings = {
  markets: [], direction: 'both', player: '', minEV: 0.05, minEdge: 0.03, minQuality: 0.75, recentWeight: 0.4,
};
export type Quote = {
  key: string; eventId: string; sport: Sport; start: string; home: string; away: string;
  market: string; subject: string; side: string; line: number | null; american: number;
  book: string; updatedAt: string; noVig: number | null;
};
export type Observation = { eventId?: string; date: string; value: number; minutes?: number; opponent?: string; location?: string };
export type Evidence = {
  samples: Observation[]; fetchedAt: string; quality: number; risks: string[];
  eligible: boolean; reason?: string; adjustment?: number;
  identifiers?: { espnEventId: string; playerId?: string; teamId?: string };
};
export type Candidate = Quote & {
  modelVersion: string; probability: number; pushProbability: number; implied: number;
  edge: number; ev: number; conservativeEV: number; projection: number;
  sampleSize: number; effectiveSample: number; last5: number; last10: number; seasonAverage: number;
  quality: number; dataAt: string; samples: Observation[]; risks: string[]; facts: string[]; explanation: string;
  identifiers?: Evidence['identifiers'];
};
export type Evaluation = { status: 'completed' | 'no_qualifying' | 'insufficient_data' | 'stale_odds'; picks: Candidate[]; rejected: Array<{ key: string; reason: string }> };
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function numeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined;
}
export function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
export function decimalOdds(american: number) {
  if (!Number.isFinite(american) || Math.abs(american) < 100) throw new Error('Invalid American odds.');
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}
export const impliedProbability = (american: number) => 1 / decimalOdds(american);
export function noVigProbabilities(prices: number[]) {
  if (prices.length !== 2) throw new Error('A complete two-way market is required.');
  const implied = prices.map(impliedProbability), total = implied.reduce((sum, item) => sum + item, 0);
  return implied.map((item) => item / total);
}
export function expectedValue(win: number, push: number, american: number) {
  if (![win, push].every(Number.isFinite) || win < 0 || push < 0 || win + push > 1 + 1e-10) throw new Error('Invalid win/push probabilities.');
  return win * (decimalOdds(american) - 1) - Math.max(0, 1 - win - push);
}
export function readSettings(value: unknown, sport: Sport): Settings {
  const row = object(value);
  const selected = array(row.markets);
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((item) => typeof item !== 'string' || !(markets[sport] as readonly string[]).includes(item))) throw new Error('Select supported, non-duplicate markets.');
  if (row.direction !== 'both' && row.direction !== 'over' && row.direction !== 'under') throw new Error('Invalid over/under selection.');
  const bounded = (key: string, low: number, high: number) => {
    const value = row[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error(`Invalid ${key} setting.`);
    return value;
  };
  if (typeof row.player !== 'string' || row.player.length > 100) throw new Error('Invalid player filter.');
  return { markets: selected as string[], direction: row.direction, player: row.player.trim(),
    minEV: bounded('minEV', 0, 1), minEdge: bounded('minEdge', 0, 0.5), minQuality: bounded('minQuality', 0.75, 1),
    recentWeight: bounded('recentWeight', 0, 0.6) };
}
export function readQuotes(value: unknown, sport: Sport): Quote[] {
  const event = object(value);
  if (!text(event.id) || !text(event.home_team) || !text(event.away_team) || !Number.isFinite(Date.parse(text(event.commence_time)))) throw new Error('Odds provider returned an invalid event.');
  const result: Quote[] = [];
  for (const rawBook of array(event.bookmakers)) {
    const book = object(rawBook);
    if (!text(book.key)) throw new Error('Odds provider returned an invalid sportsbook.');
    for (const rawMarket of array(book.markets)) {
      const market = object(rawMarket), name = text(market.key);
      if (!(markets[sport] as readonly string[]).includes(name)) continue;
      const updatedAt = text(market.last_update) || text(book.last_update);
      if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Odds are missing their update time.');
      const outcomes = array(market.outcomes).map(object);
      for (const outcome of outcomes) {
        const price = numeric(outcome.price), side = text(outcome.name);
        const line = numeric(outcome.point) ?? null;
        if (price === undefined || !side || (name !== 'h2h' && line === null)) throw new Error('Odds provider returned an invalid price or line.');
        decimalOdds(price);
        const subject = text(outcome.description) || (name === 'totals' ? `${text(event.away_team)} @ ${text(event.home_team)}` : side);
        const opposite = outcomes.filter((other) => {
          if (other === outcome || other.name === outcome.name) return false;
          if (name === 'h2h') return true;
          if (name === 'spreads') return numeric(other.point) === -Number(line);
          return other.description === outcome.description && numeric(other.point) === line;
        });
        const noVig = opposite.length === 1 && numeric(opposite[0].price) !== undefined
          ? noVigProbabilities([price, Number(opposite[0].price)])[0] : null;
        result.push({ key: [event.id, name, subject, side, line ?? ''].join('|'), eventId: text(event.id), sport,
          start: text(event.commence_time), home: text(event.home_team), away: text(event.away_team),
          market: name, subject, side, line, american: price, book: text(book.title) || text(book.key), updatedAt, noVig });
      }
    }
  }
  return result;
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
export function evaluate(quotes: Quote[], evidence: Map<string, Evidence>, settings: Settings, now: number): Evaluation {
  const rejected: Evaluation['rejected'] = [], candidates: Candidate[] = [];
  const best = new Map<string, Quote>();
  for (const quote of quotes) {
    if (!Number.isFinite(Date.parse(quote.updatedAt)) || !Number.isFinite(Date.parse(quote.start))
      || (quote.line !== null && !Number.isFinite(quote.line)) || !Number.isFinite(quote.american) || Math.abs(quote.american) < 100
      || (quote.noVig !== null && (!Number.isFinite(quote.noVig) || quote.noVig <= 0 || quote.noVig >= 1))) {
      rejected.push({ key: quote.key, reason: 'Invalid price, probability, line or timestamp.' }); continue;
    }
    if (!settings.markets.includes(quote.market) || (settings.player && quote.market.startsWith('player_') && !normalize(quote.subject).includes(normalize(settings.player)))) continue;
    if (settings.direction !== 'both' && ['Over', 'Under'].includes(quote.side) && quote.side.toLowerCase() !== settings.direction) continue;
    if (Date.parse(quote.start) <= now) { rejected.push({ key: quote.key, reason: 'Game has started; pregame analysis only.' }); continue; }
    if (now - Date.parse(quote.updatedAt) > 10 * 60_000 || Date.parse(quote.updatedAt) > now + 60_000) {
      rejected.push({ key: quote.key, reason: 'Stale or future-dated odds.' }); continue;
    }
    if (quote.noVig === null) { rejected.push({ key: quote.key, reason: 'A complete matched two-way sportsbook market is required.' }); continue; }
    const previous = best.get(quote.key);
    if (!previous || decimalOdds(quote.american) > decimalOdds(previous.american)) best.set(quote.key, quote);
  }
  for (const quote of best.values()) {
    const data = evidence.get(quote.key);
    const reject = (reason: string) => rejected.push({ key: quote.key, reason });
    if (!data?.eligible) { reject(data?.reason ?? 'Verified matchup/player data unavailable.'); continue; }
    if (data.quality < settings.minQuality || now - Date.parse(data.fetchedAt) > 60 * 60_000 || Date.parse(data.fetchedAt) > now + 60_000 || !Number.isFinite(Date.parse(data.fetchedAt))) {
      reject('Insufficient data completeness or stale source data.'); continue;
    }
    const samples = data.samples.filter((row) => Number.isFinite(row.value) && Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) < now && Date.parse(row.date) < Date.parse(quote.start))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const minimum = quote.sport === 'NBA' ? 12 : 8;
    if (samples.length < minimum || samples.length !== data.samples.length) { reject(`Needs at least ${minimum} valid, strictly prior regular-season observations.`); continue; }
    if (now - Date.parse(samples[0].date) > (quote.sport === 'NBA' ? 10 : 21) * 86_400_000) { reject('Recent playing/team form is unavailable.'); continue; }
    if (quote.noVig === null) { reject('A complete matched two-way sportsbook market is required.'); continue; }
    const threshold = quote.market === 'h2h' || quote.market === 'spreads' ? -(quote.line ?? 0) : quote.line;
    if (threshold === null) { reject('Exact line unavailable.'); continue; }
    const observed = samples.map((row) => row.value);
    const values = observed.map((value) => quote.market === 'h2h' || quote.market === 'spreads'
      ? Math.round(value + (data.adjustment ?? 0)) : value + (data.adjustment ?? 0));
    const weights = samples.map((_, index) => (1 - settings.recentWeight) / samples.length + (index < 10 ? settings.recentWeight / Math.min(10, samples.length) : 0));
    const sign = quote.side === 'Under' ? -1 : 1;
    const nbaMoneyline = quote.sport === 'NBA' && quote.market === 'h2h';
    const wins = values.reduce((sum, value, i) => sum + (sign * (value - threshold) > 0 ? weights[i]
      : nbaMoneyline && value === threshold ? weights[i] / 2 : 0), 0);
    const push = nbaMoneyline ? 0 : Math.min(1, values.reduce((sum, value, i) => sum + (value === threshold ? weights[i] : 0), 0));
    const effectiveSample = 1 / weights.reduce((sum, value) => sum + value * value, 0);
    const conditionalWin = 1 - push > 0 ? Math.min(1, wins / (1 - push)) : 0;
    const decisiveSample = effectiveSample * (1 - push);
    const conditional = (conditionalWin * decisiveSample + quote.noVig * 4) / (decisiveSample + 4);
    const probability = conditional * (1 - push);
    const uncertainty = Math.sqrt(conditional * (1 - conditional) / (decisiveSample + 5));
    const conservative = Math.max(0, conditional - 1.645 * uncertainty) * (1 - push);
    const implied = impliedProbability(quote.american);
    const edge = conditional - implied, ev = expectedValue(probability, push, quote.american);
    const conservativeEV = expectedValue(conservative, push, quote.american);
    if (edge < settings.minEdge || ev < settings.minEV || conservativeEV <= 0) { reject('Exact price fails edge, EV or conservative uncertainty threshold.'); continue; }
    const projection = values.reduce((sum, value, i) => sum + value * weights[i], 0);
    const facts = [
      `${quote.subject}: ${quote.side}${quote.line === null ? '' : ` ${quote.line}`} at ${quote.american > 0 ? '+' : ''}${quote.american} (${quote.book}).`,
      `The weighted baseline projection is ${projection.toFixed(1)} from ${samples.length} prior games.`,
      `Observed last 5 average ${mean(observed.slice(0, 5)).toFixed(1)}; last 10 average ${mean(observed.slice(0, 10)).toFixed(1)}.`,
      `Estimated EV ${(ev * 100).toFixed(1)}% of one unit, including pushes. This baseline is not calibrated or independently validated.`,
    ];
    candidates.push({ ...quote, modelVersion, probability, pushProbability: push, implied, edge, ev, conservativeEV, projection,
      sampleSize: samples.length, effectiveSample, last5: mean(observed.slice(0, 5)), last10: mean(observed.slice(0, 10)), seasonAverage: mean(observed),
      quality: data.quality, dataAt: data.fetchedAt, samples, risks: data.risks, facts, explanation: facts.join(' '), identifiers: data.identifiers });
  }
  candidates.sort((a, b) => b.conservativeEV - a.conservativeEV || b.ev - a.ev);
  const picks: Candidate[] = [], subjects = new Set<string>();
  let teamMarket = false;
  for (const candidate of candidates) {
    const player = candidate.market.startsWith('player_');
    const identity = normalize(candidate.subject);
    if ((player && subjects.has(identity)) || (!player && teamMarket)) {
      rejected.push({ key: candidate.key, reason: 'Excluded as a duplicate or correlated player/team-market selection.' }); continue;
    }
    picks.push(candidate); subjects.add(identity); if (!player) teamMarket = true;
    if (picks.length === 4) break;
  }
  return { status: picks.length ? 'completed' : !best.size && rejected.some((row) => row.reason.startsWith('Stale')) ? 'stale_odds'
    : !candidates.length && rejected.some((row) => /unavailable|Needs|Insufficient/.test(row.reason)) ? 'insufficient_data' : 'no_qualifying', picks, rejected };
}
export type Settled = { probability: number; pushProbability: number; american: number; result: 'pending' | 'win' | 'loss' | 'push' | 'void'; closingAmerican?: number | null; withdrawn?: boolean };
export function performance(rows: Settled[]) {
  const settled = rows.filter((row) => ['win', 'loss', 'push'].includes(row.result));
  const decisive = settled.filter((row) => row.result !== 'push');
  const profit = settled.reduce((sum, row) => sum + (row.result === 'win' ? decimalOdds(row.american) - 1 : row.result === 'loss' ? -1 : 0), 0);
  const brier = decisive.length ? mean(decisive.map((row) => {
    const p = row.probability / (1 - row.pushProbability); return (p - Number(row.result === 'win')) ** 2;
  })) : null;
  const logLoss = decisive.length ? mean(decisive.map((row) => {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, row.probability / (1 - row.pushProbability)));
    return -(row.result === 'win' ? Math.log(p) : Math.log(1 - p));
  })) : null;
  const closing = rows.filter((row) => row.closingAmerican != null);
  return { total: rows.length, settled: settled.length, pending: rows.filter((row) => row.result === 'pending').length,
    withdrawn: rows.filter((row) => row.withdrawn).length, wins: decisive.filter((row) => row.result === 'win').length,
    winRate: decisive.length ? decisive.filter((row) => row.result === 'win').length / decisive.length : null,
    profit, roi: settled.length ? profit / settled.length : null, brier, logLoss,
    closingPriceValue: closing.length ? mean(closing.map((row) => decimalOdds(row.american) / decimalOdds(row.closingAmerican!) - 1)) : null };
}
export function performanceGroups(rows: Array<Settled & { sport: string; market: string; createdAt: string; edge: number }>) {
  const grouped = (key: (row: typeof rows[number]) => string) => {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) { const label = key(row); groups.set(label, [...groups.get(label) ?? [], row]); }
    return [...groups].map(([label, values]) => ({
      label, ...performance(values),
      predicted: values.some((row) => row.result === 'win' || row.result === 'loss')
        ? mean(values.filter((row) => row.result === 'win' || row.result === 'loss').map((row) => row.probability / (1 - row.pushProbability))) : null,
    })).sort((a, b) => a.label.localeCompare(b.label));
  };
  return {
    sport: grouped((row) => row.sport), market: grouped((row) => row.market),
    price: grouped((row) => row.american < 0 ? 'Favorites / negative odds' : 'Underdogs / plus money'),
    odds: grouped((row) => row.american < -150 ? 'Below -150' : row.american < 0 ? '-150 to -100' : row.american <= 150 ? '+100 to +150' : 'Above +150'),
    probability: grouped((row) => `${Math.floor(row.probability / (1 - row.pushProbability) * 10) * 10}% band`),
    edge: grouped((row) => row.edge < 0.05 ? 'Below 5 pp' : row.edge < 0.1 ? '5 to 10 pp' : '10+ pp'),
    month: grouped((row) => row.createdAt.slice(0, 7)),
  };
}
export function replayBacktest(cases: Array<{ quote: Quote; evidence: Evidence; asOf: string; outcome: 'win' | 'loss' | 'push' }>, settings: Settings) {
  const rows: Settled[] = [], market: Settled[] = [], baseline: Settled[] = [];
  const seen = new Map<string, 'win' | 'loss' | 'push'>();
  for (const item of [...cases].sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf))) {
    if (!['win', 'loss', 'push'].includes(item.outcome)) throw new Error('Historical replay requires a valid settled outcome.');
    const cutoff = Date.parse(item.asOf);
    if (!Number.isFinite(cutoff) || Date.parse(item.quote.updatedAt) > cutoff || Date.parse(item.evidence.fetchedAt) > cutoff
      || item.evidence.samples.some((row) => Date.parse(row.date) >= cutoff)) throw new Error('Historical replay contains future information.');
    const result = evaluate([item.quote], new Map([[item.quote.key, item.evidence]]), settings, cutoff);
    for (const pick of result.picks) {
      const fingerprint = `${pick.key}|${pick.book}|${pick.american}|${pick.modelVersion}`;
      const previous = seen.get(fingerprint);
      if (previous !== undefined) {
        if (previous !== item.outcome) throw new Error('Historical replay contains conflicting outcomes for the same selection and price.');
        continue;
      }
      seen.set(fingerprint, item.outcome);
      const row = { probability: pick.probability, pushProbability: pick.pushProbability, american: pick.american, result: item.outcome };
      rows.push(row);
      market.push({ ...row, probability: (pick.noVig ?? pick.implied) * (1 - pick.pushProbability) });
      baseline.push({ ...row, probability: 0.5 * (1 - pick.pushProbability) });
    }
  }
  return { label: 'Historical simulation, not live performance', evaluatedCases: cases.length, ...performance(rows),
    benchmarks: { cohort: 'Same qualifying selections and actual prices; only probabilities differ.', market: performance(market), coinFlip: performance(baseline) } };
}
