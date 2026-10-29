import { pickBlurb } from '../../supabase/functions/_shared/gamewaire.ts';
import type { Candidate } from './gamewaire';
import type { Angle } from './theAngle';

const marketLabels: Record<string, string> = {
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: 'Made threes',
  player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards', player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
  totals: 'Total points',
};
export function gamewaireAngleDraft(picks: (Candidate & { isGameLean: boolean })[], season: number | null, week: number | null): Angle {
  if (!season || !week) throw new Error('The Angle season and week are still loading. Retry shortly.');
  if (!picks.length) throw new Error('Choose published picks before creating a post.');
  const narrative = picks.map((pick, index) => {
    const selection = pick.market === 'h2h' ? `${pick.subject} ML` : pick.market === 'spreads'
      ? `${pick.subject} ${pick.line !== null && pick.line > 0 ? '+' : ''}${pick.line ?? ''}`
      : `${pick.subject} - ${pick.side} ${pick.line ?? ''} ${marketLabels[pick.market] ?? pick.market}`;
    return `#${index + 1} ${pick.isGameLean ? 'Game Lean' : 'Top Pick'}: ${selection} (${pick.american > 0 ? '+' : ''}${pick.american})\n${pick.away} @ ${pick.home}`;
  }).join('\n\n');
  const evidence = picks.map((pick, index) => {
    const sentences = pickBlurb(pick).split(/(?<=[.!?])\s+(?=[A-Z])/);
    const context = sentences.find((sentence) => /offensive advantage|control the matchup|favorable scoring matchup|main challenge|responded well|built on wins|favorable matchup|favors the under|typical production|aligned with recent production|some momentum/.test(sentence))
      ?? sentences.find((sentence) => sentence.includes('limited backing')) ?? sentences[0];
    return `#${index + 1}: ${context}`;
  }).join('\n\n');
  if (narrative.length > 1500 || evidence.length > 1500) throw new Error('These picks exceed the Angle text limit. Filter to fewer published picks and retry.');
  return { id: '', season, week, game_id: 'COMBO:0', matchup: 'GamewAIre published picks', kind: 'team',
    subject: 'GamewAIre Best Bets', category: 'Other', title: 'GamewAIre Best Bets', narrative, evidence,
    counterpoint: '', pick: '', picks: [], source_url: '', source_label: '', reviewed: false, status: 'draft',
    revision: 0, section: 'angle', news_types: [], themes: ['betting'], post_to_x: false };
}
