import { modelVersion, normalize, rankTopPicks, valueClassification } from './gamewaire.ts';
import type { Candidate, TeamLean } from './gamewaire.ts';
import { pickBreakdown } from './gamewaireNarrative.ts';
import { simulationAllowsMoneyline } from './nflSimulationAlignment.ts';
import type { NFLGameSimulation } from './nflSimulation.ts';

export type ScoreboardPick = { eventId: string; start: string; team: string; market?: 'h2h' | 'spreads'; opponent?: string; evidenceAt?: string; rank: number; label: 'GamewAIre Pick' | 'GamewAIre Winner Lean'; reason: string; savedAt: string };
export function scoreboardBreakdown(pick: Candidate): string {
  return pickBreakdown(pick);
}
export function scoreboardPicks(candidates: Candidate[], now = Date.now(), options: { nbaGames?: number; winnerLeans?: TeamLean[]; nflSimulations?: Map<string, NFLGameSimulation>; onSelection?: (pick: Candidate) => void } = {}): ScoreboardPick[] {
  const verified = (pick: Candidate) => ['h2h', 'spreads'].includes(pick.market)
    && pick.modelVersion?.startsWith(modelVersion) && !!pick.identifiers?.espnEventId
    && [pick.ev, pick.edge, pick.conservativeEV, pick.quality, pick.american].every(Number.isFinite)
    && Math.abs(pick.american) >= 100 && (pick.market === 'h2h' || pick.line !== null && Number.isFinite(pick.line))
    && pick.noVig !== null && Number.isFinite(pick.noVig) && pick.noVig > 0 && pick.noVig < 1
    && pick.sampleSize >= (pick.sport === 'NBA' ? 12 : 8)
    && Date.parse(pick.dataAt) <= now + 60_000 && Date.parse(pick.dataAt) < Date.parse(pick.start)
    && Date.parse(pick.updatedAt) <= Date.parse(pick.dataAt) + 60_000
    && Date.parse(pick.dataAt) - Date.parse(pick.updatedAt) <= 600_000
    && [pick.home, pick.away].some(team => normalize(team) === normalize(pick.subject))
    && Array.isArray(pick.samples) && Array.isArray(pick.risks);
  const qualified = (pick: Candidate) => verified(pick) && ['ELITE VALUE', 'A VALUE', 'B VALUE'].includes(valueClassification(pick))
    && (!options.nflSimulations || Date.parse(pick.start) <= now || simulationAllowsMoneyline(pick, options.nflSimulations.get(pick.identifiers?.espnEventId ?? '')));
  const winners = [...candidates.filter(pick => pick.market === 'h2h').map(pick => ({ pick, qualifies: true })), ...options.winnerLeans ?? []]
    .filter(({ pick }) => pick.sport === 'NBA' && pick.market === 'h2h' && pick.line === null && verified(pick)
      && pick.quality >= .75 && Number.isFinite(pick.probability) && pick.probability > 0 && pick.probability < 1 && pick.pushProbability === 0
      && pick.samples.length >= 12 && pick.samples.every(sample => Number.isFinite(sample.value)
        && Number.isFinite(Date.parse(sample.date)) && Date.parse(sample.date) < Date.parse(pick.dataAt)
        && Date.parse(sample.date) < Date.parse(pick.start)))
    .sort((a, b) => b.pick.probability - a.pick.probability || b.pick.conservativeEV - a.pick.conservativeEV || a.pick.key.localeCompare(b.pick.key));
  const shortSlate = options.nbaGames !== undefined && options.nbaGames < 3;
  const limit = shortSlate ? options.nbaGames === 0 ? 0 : 1 : 3;
  const events = new Set<string>();
  const result: ScoreboardPick[] = [];
  const add = (pick: Candidate, lean: boolean) => {
    const eventId = pick.identifiers!.espnEventId;
    if (events.has(eventId) || result.length >= limit) return;
    events.add(eventId);
    options.onSelection?.(pick);
    result.push({ eventId, start: pick.start, team: pick.subject, market: pick.market === 'h2h' ? 'h2h' : 'spreads', opponent: normalize(pick.subject) === normalize(pick.home) ? pick.away : pick.home,
      evidenceAt: pick.dataAt, rank: result.length + 1, label: lean ? 'GamewAIre Winner Lean' : 'GamewAIre Pick', savedAt: pick.updatedAt,
      reason: lean ? scoreboardBreakdown(pick).replace('\n\n', '\n\nModel winner lean for daily coverage, not a value-qualified pick or betting recommendation. ') : scoreboardBreakdown(pick) });
  };
  if (!shortSlate) for (const pick of rankTopPicks(candidates.filter(qualified))) add(pick, false);
  if (options.nbaGames !== undefined) for (const winner of winners) {
    add(winner.pick, !winner.qualifies || !qualified(winner.pick));
  }
  return result;
}
