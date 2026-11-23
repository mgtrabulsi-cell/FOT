import type { Game } from './sportsData';
import type { BotReport } from './gamewireBot';
import { nbaPlayerBreakdown } from './nbaPlayerLab';
import type { NBAPlayerLabReport } from './nbaPlayerLab';
import type { ResearchSnapshot, ResearchSection } from './research';
import type { NFLGameSimulation, SimulationScenario } from '../../supabase/functions/_shared/nflSimulation';
import type { NBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation';
import { projectedSimulationScore, roundedSimulationBox } from '../../supabase/functions/_shared/nflSimulation';

const number = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : 'Unavailable';
const gameRef = (game: Game): NonNullable<ResearchSnapshot['game']> => ({
  eventId: game.eventId, kickoff: game.date, homeId: game.home.id, awayId: game.away.id, home: game.home.abbr, away: game.away.abbr,
});
export function captureNFLPlayer(report: BotReport): ResearchSnapshot {
  const matchup = report.matchup, stamp = report.projections.find(row => row.simulation)?.simulation;
  return { league: 'NFL', kind: 'player', title: report.player.name,
    player: { id: report.player.id, teamId: report.player.teamId },
    game: matchup ? { eventId: matchup.eventId, kickoff: matchup.start,
      homeId: matchup.home ? report.player.teamId : matchup.opponentId, awayId: matchup.home ? matchup.opponentId : report.player.teamId,
      home: matchup.home ? report.player.teamAbbr : matchup.opponent, away: matchup.home ? matchup.opponent : report.player.teamAbbr } : null,
    forecastAt: stamp?.forecastAt ?? null, identity: stamp ? `${stamp.version} / ${stamp.scenarioId}` : `Player analysis checked ${report.checkedAt}`,
    sections: [
      { title: 'Saved matchup projections', text: 'Conditional estimates, not betting recommendations. Unavailable values are not zero.',
        rows: report.projections.map(row => ({ label: row.label, value: number(row.estimate) })) },
      { title: 'Research context', text: `${report.matchupText} ${report.availability}`, rows: [] },
      { title: 'Recorded recent averages, not projections', rows: [...report.workload, ...report.production].map(row =>
        ({ label: `${row.label} (${row.games} appearances)`, value: number(row.average) })) },
    ] };
}
export function captureNBAPlayer(report: NBAPlayerLabReport): ResearchSnapshot {
  const breakdown = nbaPlayerBreakdown(report);
  return { league: 'NBA', kind: 'player', title: report.player.name, player: { id: report.player.id, teamId: report.player.teamId },
    game: report.game ? gameRef(report.game) : null, forecastAt: report.forecastAt,
    identity: `${report.forecastVersion ?? 'Player projection (version unavailable)'} / ${report.forecastAt ?? 'no saved forecast'}`,
    sections: [
      { title: 'Saved matchup projections', text: `Conditional on playing. Availability: ${report.projection?.status ?? 'Not verified'}.`,
        rows: (['points', 'rebounds', 'assists', 'pra', 'threePointers'] as const).map((stat, index) =>
          ({ label: ['PTS', 'REB', 'AST', 'PRA', '3PM'][index], value: number(report.projection?.stats[stat]?.mean) })) },
      { title: 'Last five recorded appearances', text: breakdown.recentText, rows: [] },
      { title: 'Opponent breakdown', text: breakdown.opponentText.join('\n'), rows: [] },
    ] };
}
export function captureNFLMatchup(game: Game, forecast: NFLGameSimulation, scenario: SimulationScenario): ResearchSnapshot {
  if (forecast.status !== 'ready' || forecast.eventId !== game.eventId || Date.parse(forecast.kickoff) !== Date.parse(game.date)
    || scenario.home?.id !== game.home.id || scenario.away?.id !== game.away.id || !forecast.scenarios.some(row => row.id === scenario.id))
    throw new Error('This forecast does not match the displayed matchup. Wait for the correct saved simulation.');
  const score = projectedSimulationScore(scenario);
  return { league: 'NFL', kind: 'matchup', title: `${game.away.abbr} at ${game.home.abbr}`, game: gameRef(game),
    forecastAt: forecast.forecastAt ?? null, identity: `${forecast.version} / ${scenario.id}`,
    sections: [{ title: 'Projected final score', text: 'Experimental estimates, not betting recommendations. Player estimates are conditional on playing.', rows: [
      { label: game.away.abbr, value: number(score?.away) }, { label: game.home.abbr, value: number(score?.home) },
    ] }, ...[scenario.away, scenario.home].flatMap(team => {
      if (!team) return [];
      const box = team.totals ? roundedSimulationBox({ ...team, totals: team.totals }, team.id === scenario.home?.id ? score?.home : score?.away) : null;
      return [{
        title: `${team.abbr} player projections`, rows: team.players.map(player => ({
          label: `${player.name}${player.estimate ? ' (team-position estimate)' : ''}`,
          value: Object.entries(box?.players[player.id] ?? {}).map(([label, stat]) => `${label}: ${stat}`).join(' / ') || 'Unavailable',
        })),
      }];
    })] };
}
export function captureNBAMatchup(game: Game, forecast: NBAGameSimulation): ResearchSnapshot {
  if (forecast.status !== 'ready' || forecast.eventId !== game.eventId || Date.parse(forecast.kickoff) !== Date.parse(game.date)
    || forecast.home?.id !== game.home.id || forecast.away?.id !== game.away.id)
    throw new Error('This forecast does not match the displayed matchup. Wait for the correct saved simulation.');
  const teams = [forecast.away, forecast.home].filter(team => !!team);
  const sections: ResearchSection[] = [{ title: 'Projected final score', text: 'Experimental estimates, not betting recommendations. Player estimates are conditional on playing.',
    rows: teams.map(team => ({ label: team.abbr, value: number(team.score.mean) })) },
    ...teams.map(team => ({ title: `${team.abbr} player projections`, rows: team.players.filter(player => !player.excluded).map(player => ({
      label: player.name, value: (['points', 'rebounds', 'assists', 'pra', 'threePointers'] as const).map((stat, index) =>
        `${['PTS', 'REB', 'AST', 'PRA', '3PM'][index]}: ${number(player.stats[stat]?.mean)}`).join(' / '),
    })) }))];
  return { league: 'NBA', kind: 'matchup', title: `${game.away.abbr} at ${game.home.abbr}`, game: gameRef(game),
    forecastAt: forecast.forecastAt ?? null, identity: forecast.version, sections };
}
