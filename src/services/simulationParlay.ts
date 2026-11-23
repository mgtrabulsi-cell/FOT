import { isAllowedPickSide, isAllowedPropPrice, modelVersion, normalize, rankTopPicks } from '../../supabase/functions/_shared/gamewaire.ts';
import { matchesSimulationAlignment } from '../../supabase/functions/_shared/nflSimulationAlignment.ts';
import type { NFLGameSimulation } from '../../supabase/functions/_shared/nflSimulation.ts';
import type { NBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation.ts';
import type { AnalysisRun, Candidate, OddsEvent } from './gamewaire';
import type { Game } from './sportsData';
import { newParlayGraphic, parlayGraphicError } from './parlayGraphic.ts';
import type { ParlayGraphic } from './parlayGraphic';
import { gamewaireMarketLabels } from './gamewairePresentation.ts';

const teamKey = (name: string) => normalize(name).replace(/^losangeles/, 'la');
export function simulationOddsEvent(events: OddsEvent[], game: Game, sport: 'NFL' | 'NBA') {
  const matches = events.filter(event => event.sport === sport && Date.parse(event.start) === Date.parse(game.date)
    && teamKey(event.home) === teamKey(game.home.name) && teamKey(event.away) === teamKey(game.away.name));
  if (matches.length !== 1) throw new Error('No unique sportsbook matchup matches this simulation. No substitute game was selected.');
  return matches[0];
}
const nbaStats: Record<string, 'points' | 'rebounds' | 'assists' | 'threePointers'> = {
  player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists', player_threes: 'threePointers',
};
export function simulationParlay(run: AnalysisRun, game: Game, sport: 'NFL' | 'NBA',
  forecast: NFLGameSimulation | NBAGameSimulation, now = Date.now()): { graphic: ParlayGraphic; picks: Candidate[] } {
  if (forecast.status !== 'ready' || forecast.eventId !== game.eventId || Date.parse(forecast.kickoff) !== Date.parse(game.date)
    || run.sport !== sport || Date.parse(run.event_start) !== Date.parse(game.date) || Date.parse(game.date) <= now)
    throw new Error('A matching ready pregame simulation and analysis are required.');
  if (sport === 'NFL' && (!('scenarios' in forecast) || !matchesSimulationAlignment(run.payload.simulationAlignment, forecast)))
    throw new Error('The saved simulation changed. Refresh the simulation before creating this parlay.');
  const seen = new Set<string>();
  const picks = rankTopPicks((run.payload.picks ?? []).filter(pick => {
    if (pick.sport !== sport || pick.eventId !== run.event_id || pick.identifiers?.espnEventId !== game.eventId
      || teamKey(pick.home) !== teamKey(game.home.name) || teamKey(pick.away) !== teamKey(game.away.name)
      || Date.parse(pick.start) !== Date.parse(game.date) || !pick.market.startsWith('player_')
      || !pick.modelVersion.startsWith(modelVersion) || !isAllowedPropPrice(pick) || !isAllowedPickSide(pick)
      || !Number.isFinite(pick.probability) || pick.probability <= 0 || pick.probability > 1
      || pick.line === null || !Number.isFinite(pick.line) || !pick.identifiers.playerId
      || !Number.isFinite(Date.parse(pick.updatedAt)) || now - Date.parse(pick.updatedAt) > 600_000
      || Date.parse(pick.updatedAt) > now + 60_000
      || !Number.isFinite(Date.parse(pick.dataAt)) || now - Date.parse(pick.dataAt) > 3_600_000
      || Date.parse(pick.dataAt) > now + 60_000) return false;
    if (sport === 'NBA') {
      if ('scenarios' in forecast) return false;
      const nba = forecast;
      const team = [nba.home, nba.away].find(row => row?.id === pick.identifiers?.teamId);
      const player = team?.players.find(row => row.id === pick.identifiers?.playerId);
      const stat = nbaStats[pick.market];
      const estimate = stat && player?.stats[stat]?.mean;
      if (estimate === undefined || !Number.isFinite(estimate) || estimate <= pick.line) return false;
    }
    return true;
  })).filter(pick => {
    const key = pick.identifiers!.playerId!;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 3);
  if (picks.length !== 3) throw new Error(`Only ${picks.length}/3 distinct players have supported, fresh simulation-aligned props. No missing legs were invented.`);
  const graphic: ParlayGraphic = { ...newParlayGraphic(), title: 'SAME GAME PARLAY', images: false,
    subtitle: `${game.away.abbr} @ ${game.home.abbr} / GamewAIre Sim`,
    legs: picks.map(pick => ({ id: crypto.randomUUID(), sport, type: 'player', side: 'Over', line: String(pick.line),
      market: gamewaireMarketLabels[pick.market] ?? pick.market.replace(/^player_/, '').replace(/_/g, ' '),
      subject: { id: pick.identifiers!.playerId!, name: pick.subject, image: '', teamLogo: '',
        teamId: pick.identifiers!.teamId ?? '', teamName: pick.identifiers?.teamId === game.home.id ? game.home.abbr : game.away.abbr,
        color: (pick.identifiers?.teamId === game.home.id ? game.home.color : game.away.color).replace(/^#/, '') } })) };
  const error = parlayGraphicError(graphic);
  if (error) throw new Error(error);
  return { graphic, picks };
}
