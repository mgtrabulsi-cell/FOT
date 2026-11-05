import { impliedProbability, normalize, pickBlurb } from './gamewaire.ts';
import type { Candidate } from './gamewaire.ts';

export const gamewaireMarketLabels: Record<string, string> = {
  h2h: 'Moneyline', spreads: 'Spread', totals: 'Total points',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: 'Made threes',
  player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards', player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
};
export const gamewairePickTitle = (pick: Candidate) => pick.market === 'h2h' ? `${pick.subject} ML`
  : pick.market === 'spreads' ? `${pick.subject}${pick.line === null ? '' : ` ${pick.line > 0 ? '+' : ''}${pick.line}`}`
  : `${pick.subject} · ${pick.side}${pick.line === null ? '' : ` ${pick.line}`} ${gamewaireMarketLabels[pick.market] ?? pick.market.replace(/_/g, ' ')}`;

function matchupContext(pick: Candidate) {
  const key = (name: string) => normalize(name).replace(/^losangeles/, 'la');
  const opponentName = key(pick.subject) === key(pick.home) ? pick.away : pick.home;
  const own = pick.teamContext, opponent = pick.opponents?.find(row => key(row.team) === key(opponentName));
  const paired = own && opponent && key(own.team) === key(pick.subject) && own.games >= 3 && opponent.games >= 3 && own.season === opponent.season;
  const sentences = [`GamewAIre likes ${pick.subject}${pick.market === 'spreads' ? ' to cover the spread' : ' to win outright on the moneyline'} in this matchup.`];
  if (paired && [own.pointsScored, opponent.pointsScored, own.pointsAllowed, opponent.pointsAllowed].every(value => Number.isFinite(value) && value >= 0)) {
    sentences.push(`In the available ${own.season} season sample, ${pick.subject} average ${own.pointsScored.toFixed(1)} points per game and allow ${own.pointsAllowed.toFixed(1)}, compared with ${opponent.pointsScored.toFixed(1)} scored and ${opponent.pointsAllowed.toFixed(1)} allowed by ${opponentName}.`);
    if (Number.isInteger(own.rank) && Number.isInteger(own.leagueSize) && own.rank >= 1 && own.rank <= own.leagueSize)
      sentences.push(`Their defense ranks ${own.rank}${own.tied ? ' (tied)' : ''} of ${own.leagueSize} in points allowed; lower is better.`);
    const offense = own.pointsScored > opponent.pointsScored, defense = own.pointsAllowed < opponent.pointsAllowed;
    sentences.push(offense && defense ? 'That gives them both the stronger scoring output and the better points-allowed record.'
      : offense ? 'Their scoring output supports the pick, although the points-allowed comparison does not offer a defensive advantage.'
      : defense ? 'Their points-allowed record supports the pick, although their opponent has matched or exceeded their scoring output.'
      : 'The scoring and points-allowed comparisons do not favor this selection; those are counterpoints rather than supporting evidence.');
    if (Number.isInteger(opponent.rank) && opponent.rank > opponent.leagueSize * 2 / 3 && opponent.rank <= opponent.leagueSize)
      sentences.push(`${opponentName} rank ${opponent.rank} of ${opponent.leagueSize} in points allowed, a scoring-defense weakness in the available sample.`);
  } else sentences.push('There is not enough verified paired scoring and defensive data for a fuller matchup comparison.');
  return sentences.join(' ');
}

function modelComparison(pick: Candidate) {
  const sentences: string[] = [];
  const teamPick = pick.market === 'h2h' || pick.market === 'spreads';
  const cutoff = Math.min(Date.parse(pick.dataAt), Date.parse(pick.start));
  const recent = [...(pick.matchupForm?.find(row => normalize(row.team) === normalize(pick.subject))?.recent ?? pick.samples ?? [])]
    .filter(row => Number.isFinite(row.value) && Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) < cutoff
      && cutoff - Date.parse(row.date) <= (pick.sport === 'NBA' ? 10 : 42) * 86400000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 3);
  if (teamPick && recent.length === 3)
    sentences.push(`Recent form: ${pick.subject} won ${recent.filter(row => row.value > 0).length} of their last three recorded games${pick.market === 'spreads' ? ' outright, not necessarily against the spread' : ''}.`);
  sentences.push('The model uses weighted prior-game outcomes and market pricing.');
  const push = pick.pushProbability;
  const valid = [pick.probability, push, pick.american].every(Number.isFinite)
    && pick.probability >= 0 && push >= 0 && push < 1 && pick.probability + push <= 1 + 1e-8 && Math.abs(pick.american) >= 100;
  if (!valid) {
    sentences.push('Verified model and sportsbook probabilities are unavailable for this saved pick, so no percentage edge is shown.');
    return sentences.join(' ');
  }
  const conditional = pick.probability / (1 - push), implied = impliedProbability(pick.american), edge = (conditional - implied) * 100;
  const action = pick.market === 'h2h' ? `${pick.subject} to win` : pick.market === 'spreads' ? `${pick.subject} to cover the spread` : 'this selection to win';
  const price = `${pick.american > 0 ? '+' : ''}${pick.american}`;
  sentences.push(`GamewAIre estimates ${action} ${(conditional * 100).toFixed(1)}% of the time${push > 0 ? ' excluding pushes' : ''}, compared with the sportsbook's ${(implied * 100).toFixed(1)}% implied probability, ${edge >= 0 ? 'an estimated' : 'a'} ${Math.abs(edge).toFixed(1)} percentage-point ${edge >= 0 ? 'edge' : 'deficit'} at the saved ${pick.market === 'h2h' ? 'moneyline' : 'price'} of ${price}.`);
  if (push > 0) sentences.push(`The model separately estimates a ${(push * 100).toFixed(1)}% push chance.`);
  return sentences.join(' ');
}

export function pickBreakdown(pick: Candidate) {
  const title = gamewairePickTitle(pick);
  const teamPick = pick.market === 'h2h' || pick.market === 'spreads';
  const context = teamPick ? matchupContext(pick) : `GamewAIre likes ${title}. ${pickBlurb(pick)}`;
  return [title, context, modelComparison(pick), `GamewAIre Verdict: ${title}`].join('\n\n');
}
