import { normalize } from './gamewaire.ts';
import type { Quote } from './gamewaire.ts';
import { projectedSimulationScore, roundedSimulationBox } from './nflSimulation.ts';
import type { NFLGameSimulation, SimulationScenario, SimulationStat } from './nflSimulation.ts';
import { forecastDistribution } from './gamewireBotIntelligence.ts';
import type { BotProjection } from './gamewireBotProjections.ts';

export function defaultSimulationScenario(forecast: NFLGameSimulation): SimulationScenario | undefined {
  return forecast.status === 'ready' ? forecast.scenarios.find(row => !row.issue && row.home && row.away) : undefined;
}

export function simulationAllowsMoneyline(pick: Quote, forecast: NFLGameSimulation | undefined): boolean {
  if (pick.sport !== 'NFL' || pick.market !== 'h2h') return true;
  if (!forecast || Date.parse(forecast.kickoff) !== Date.parse(pick.start)) return false;
  const scenario = defaultSimulationScenario(forecast);
  if (!scenario?.home || !scenario.away) return false;
  if (normalize(pick.home) !== normalize(scenario.home.name) || normalize(pick.away) !== normalize(scenario.away.name)) return false;
  const score = projectedSimulationScore(scenario);
  if (!score) return false;
  return normalize(pick.subject) === normalize(score.home > score.away ? scenario.home.name : scenario.away.name);
}

const projectionStats: Record<string, keyof SimulationStat> = {
  player_pass_yds: 'passingYards', player_rush_yds: 'rushingYards',
  player_reception_yds: 'receivingYards', player_receptions: 'receptions',
};
export function reconcileSimulationProjections(projections: BotProjection[], forecast: NFLGameSimulation, teamId: string, playerId: string): BotProjection[] {
  const scenario = defaultSimulationScenario(forecast);
  const team = [scenario?.home, scenario?.away].find(row => row?.id === teamId);
  if (!team?.totals || !team.players.some(player => player.id === playerId && !player.issue)) return projections;
  const box = roundedSimulationBox({ ...team, totals: team.totals });
  return projections.map(projection => {
    const key = projectionStats[projection.market], estimate = key ? box.players[playerId]?.[key] : undefined;
    if (estimate === undefined) return projection;
    const originalEstimate = projection.simulation ? projection.simulation.originalEstimate : projection.estimate;
    return { ...projection, estimate, yards: projection.unit === 'yards' ? estimate : projection.yards,
      simulation: { eventId: forecast.eventId, scenarioId: scenario!.id, version: forecast.version, forecastAt: forecast.forecastAt!, originalEstimate },
      distribution: forecastDistribution(estimate, projection.evidence?.observations ?? [], projection.unit === 'receptions') ?? undefined,
      explanation: `${projection.explanation} Game-specific estimate reconciled to the saved GamewAIre simulation (${scenario!.label}). Rankings and Start/Sit editorial context remain independent.`,
    };
  });
}
