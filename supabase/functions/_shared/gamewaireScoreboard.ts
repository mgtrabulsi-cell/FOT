import { modelVersion, normalize, rankTopPicks, valueClassification } from './gamewaire.ts';
import type { Candidate } from './gamewaire.ts';
import { pickBreakdown } from './gamewaireNarrative.ts';

export type ScoreboardPick = { eventId: string; start: string; team: string; rank: number; label: 'GamewAIre Pick'; reason: string; savedAt: string };
export function scoreboardBreakdown(pick: Candidate): string {
  return pickBreakdown(pick);
}
export function scoreboardPicks(candidates: Candidate[], now = Date.now()): ScoreboardPick[] {
  const eligible = candidates.filter(pick => ['h2h', 'spreads'].includes(pick.market)
    && pick.modelVersion?.startsWith(modelVersion) && !!pick.identifiers?.espnEventId
    && [pick.ev, pick.edge, pick.conservativeEV, pick.quality, pick.american].every(Number.isFinite)
    && Math.abs(pick.american) >= 100 && (pick.market === 'h2h' || pick.line !== null && Number.isFinite(pick.line))
    && pick.noVig !== null && Number.isFinite(pick.noVig) && pick.noVig > 0 && pick.noVig < 1
    && pick.sampleSize >= (pick.sport === 'NBA' ? 12 : 8)
    && ['ELITE VALUE', 'A VALUE', 'B VALUE'].includes(valueClassification(pick))
    && Date.parse(pick.dataAt) <= now + 60_000 && Date.parse(pick.dataAt) < Date.parse(pick.start)
    && Date.parse(pick.updatedAt) <= Date.parse(pick.dataAt) + 60_000
    && Date.parse(pick.dataAt) - Date.parse(pick.updatedAt) <= 600_000
    && [pick.home, pick.away].some(team => normalize(team) === normalize(pick.subject))
    && Array.isArray(pick.samples) && Array.isArray(pick.risks));
  const events = new Set<string>();
  const result: ScoreboardPick[] = [];
  for (const pick of rankTopPicks(eligible)) {
    const eventId = pick.identifiers!.espnEventId;
    if (events.has(eventId)) continue;
    events.add(eventId);
    result.push({ eventId, start: pick.start, team: pick.subject, rank: result.length + 1, label: 'GamewAIre Pick', savedAt: pick.updatedAt,
      reason: scoreboardBreakdown(pick) });
    if (result.length === 3) break;
  }
  return result;
}
