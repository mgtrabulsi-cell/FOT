import { modelVersion, normalize, rankTopPicks, valueClassification } from './gamewaire.ts';
import type { Candidate } from './gamewaire.ts';

export type ScoreboardPick = { eventId: string; start: string; team: string; rank: number; label: 'GamewAIre Pick'; reason: string; savedAt: string };
export function scoreboardBreakdown(pick: Candidate): string {
  const teamKey = (name: string) => normalize(name).replace(/^losangeles/, 'la');
  const opponentName = teamKey(pick.subject) === teamKey(pick.home) ? pick.away : pick.home;
  const paragraphs = [pick.market === 'spreads' && pick.line !== null
    ? `The pick: ${pick.subject} ${pick.line > 0 ? '+' : ''}${pick.line} to cover the spread. This is about the final margin, not simply which team wins.`
    : `The pick: ${pick.subject} to win outright. Here is how the matchup supports that selection.`];
  const own = pick.teamContext;
  const opponent = pick.opponents?.find(row => teamKey(row.team) === teamKey(opponentName));
  const paired = own && opponent && own.games >= 3 && opponent.games >= 3 && own.season === opponent.season;
  if (paired && [own.pointsScored, opponent.pointsScored].every(value => Number.isFinite(value) && value >= 0)) {
    const takeaway = own.pointsScored > opponent.pointsScored
      ? `${pick.subject} have been the more productive offense, which supports the scoring side of the pick.`
      : own.pointsScored < opponent.pointsScored
        ? `${opponentName} have been the more productive offense, so this is a challenge for the pick rather than an offensive advantage.`
        : 'Neither team has a scoring-average advantage, so offense alone does not separate them.';
    paragraphs.push(`Scoring: ${pick.subject} average ${own.pointsScored.toFixed(1)} points per game, compared with ${opponent.pointsScored.toFixed(1)} for ${opponentName}. ${takeaway}`);
  }
  if (paired && [own.pointsAllowed, opponent.pointsAllowed].every(value => Number.isFinite(value) && value >= 0)) {
    const takeaway = own.pointsAllowed < opponent.pointsAllowed
      ? `${pick.subject} have allowed fewer points, giving them the stronger defensive record in this comparison.`
      : own.pointsAllowed > opponent.pointsAllowed
        ? `${opponentName} have allowed fewer points, making their defense a concern for this selection.`
        : 'Both defenses have allowed the same scoring average, so neither has an edge on this measure.';
    paragraphs.push(`Defense: ${pick.subject} allow ${own.pointsAllowed.toFixed(1)} points per game, while ${opponentName} allow ${opponent.pointsAllowed.toFixed(1)}. ${takeaway}`);
  }
  const form = pick.matchupForm?.find(row => teamKey(row.team) === teamKey(pick.subject));
  const cutoff = Math.min(Date.parse(pick.dataAt), Date.parse(pick.start));
  const recent = [...(form?.recent ?? pick.samples)].filter(row => Number.isFinite(row.value)
    && Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) < cutoff
    && cutoff - Date.parse(row.date) <= (pick.sport === 'NBA' ? 10 : 42) * 86400000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
  if (recent.length === 3) {
    const wins = recent.filter(row => row.value > 0).length;
    const result = ['none', 'one', 'two', 'all three'][wins];
    paragraphs.push(`Recent form: ${pick.subject} have won ${result} of their last three recorded games. ${wins >= 2
      ? 'That run gives the matchup case some recent support, though it does not decide the result on its own.'
      : 'Recent results are not a strength here; this selection leans more on the overall matchup than winning momentum.'}`);
  }
  if (paragraphs.length === 1) paragraphs.push('The saved matchup model supports this selection, but there is not enough verified recent form or paired scoring data for a fuller statistical explanation.');
  return paragraphs.join('\n\n');
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
