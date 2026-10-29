import type { Candidate } from './gamewaire';

export const gamewaireMarketLabels: Record<string, string> = {
  h2h: 'Moneyline', spreads: 'Spread', totals: 'Total points',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists', player_threes: 'Made threes',
  player_pass_yds: 'Passing yards', player_rush_yds: 'Rushing yards', player_reception_yds: 'Receiving yards', player_receptions: 'Receptions',
};
export const gamewairePickTitle = (pick: Candidate) => pick.market === 'h2h' ? `${pick.subject} ML`
  : pick.market === 'spreads' ? `${pick.subject}${pick.line === null ? '' : ` ${pick.line > 0 ? '+' : ''}${pick.line}`}`
  : `${pick.subject} · ${pick.side}${pick.line === null ? '' : ` ${pick.line}`} ${gamewaireMarketLabels[pick.market] ?? pick.market.replace(/_/g, ' ')}`;
