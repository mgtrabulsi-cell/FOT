import { array, object, text } from './gamewaire.ts';
import { projectedSimulationScore, readNFLGameSimulation, nflSimulationVersion } from './nflSimulation.ts';
import type { NFLGameSimulation, SimulationStat } from './nflSimulation.ts';

export const simulationAccuracyStats = {
  passingAttempts: 'Passing attempts', completions: 'Completions', passingYards: 'Passing yards',
  passingTouchdowns: 'Passing touchdowns', rushingAttempts: 'Rushing attempts', rushingYards: 'Rushing yards',
  rushingTouchdowns: 'Rushing touchdowns', receptions: 'Receptions', receivingYards: 'Receiving yards',
  receivingTouchdowns: 'Receiving touchdowns',
} satisfies Record<keyof SimulationStat, string>;
export type SimulationAccuracyScope = { eventId: string; kickoff: string; homeTeamId: string; awayTeamId: string };
export type SimulationAccuracyPlayer = {
  playerId: string; name: string; position: string; team: string; stat: keyof SimulationStat;
  projected: number; actual: number; error: number;
};
export const featuredSimulationMinimums: Partial<Record<keyof SimulationStat, number>> = {
  rushingYards: 30, receivingYards: 30, passingYards: 200, passingTouchdowns: 2,
  receptions: 3, receivingTouchdowns: 1, rushingTouchdowns: 1,
};
export function isFeaturedSimulationPlayer(player: SimulationAccuracyPlayer): boolean {
  if ((player.stat === 'passingYards' || player.stat === 'passingTouchdowns') && player.position !== 'QB') return false;
  const minimum = featuredSimulationMinimums[player.stat];
  return minimum === undefined || player.projected >= minimum && player.actual >= minimum;
}
export type SimulationAccuracyGame = {
  eventId: string; kickoff: string; forecastAt: string; version: string; settledAt: string; scenario: string;
  home: { id: string; name: string; abbr: string; projected: number; actual: number };
  away: { id: string; name: string; abbr: string; projected: number; actual: number };
  error: number; players: SimulationAccuracyPlayer[]; issues: string[]; overtime?: boolean;
};
export type SimulationAccuracyReport = { games: SimulationAccuracyGame[]; issues: string[]; pending: number };
export function fullPlayerPerformances(report: SimulationAccuracyReport) {
  return report.games.flatMap(game => {
    const players = new Map<string, SimulationAccuracyPlayer[]>();
    for (const player of game.players) {
      if (!['receivingYards', 'receptions', 'receivingTouchdowns'].includes(player.stat)) continue;
      const key = JSON.stringify([player.playerId, player.team]);
      const rows = players.get(key) ?? [];
      rows.push(player); players.set(key, rows);
    }
    return [...players.values()].flatMap(rows => {
      const yards = rows.find(row => row.stat === 'receivingYards');
      const catches = rows.find(row => row.stat === 'receptions');
      const touchdowns = rows.find(row => row.stat === 'receivingTouchdowns');
      if (rows.length !== 3 || !yards || !catches || !touchdowns
        || !rows.every(row => row.name === yards.name && row.position === yards.position
          && Number.isFinite(row.projected) && Number.isFinite(row.actual))
        || yards.projected < 60 || yards.actual < 60 || catches.projected < 5 || catches.actual < 5
        || touchdowns.projected < .5 || touchdowns.actual < 1) return [];
      return [{ game, playerId: yards.playerId, name: yards.name, position: yards.position, team: yards.team,
        yards, catches, touchdowns }];
    });
  }).sort((a, b) => b.touchdowns.actual - a.touchdowns.actual || b.yards.actual - a.yards.actual
    || b.catches.actual - a.catches.actual || a.game.kickoff.localeCompare(b.game.kickoff)
    || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId));
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function readSimulationAccuracyScope(value: unknown): SimulationAccuracyScope[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error('Choose between one and 32 NFL games for accuracy results.');
  const rows = value.map(raw => {
    const row = object(raw);
    if (![row.eventId, row.homeTeamId, row.awayTeamId].every(id => typeof id === 'string' && /^\d{1,12}$/.test(id))
      || row.homeTeamId === row.awayTeamId || typeof row.kickoff !== 'string' || !Number.isFinite(Date.parse(row.kickoff)))
      throw new Error('Accuracy results require valid NFL events, kickoffs and teams.');
    return { eventId: text(row.eventId), kickoff: text(row.kickoff), homeTeamId: text(row.homeTeamId), awayTeamId: text(row.awayTeamId) };
  });
  if (new Set(rows.map(row => row.eventId)).size !== rows.length) throw new Error('Accuracy requests cannot contain duplicate games.');
  return rows;
}

export function compareSimulationAccuracy(forecast: NFLGameSimulation, actualValue: unknown, settledAt: string): SimulationAccuracyGame | string {
  if (forecast.status !== 'ready' || typeof forecast.forecastAt !== 'string' || !Number.isFinite(Date.parse(forecast.forecastAt)))
    throw new Error('Accuracy comparisons require a saved pregame forecast.');
  const actuals = object(actualValue), teams = array(actuals.teams).map(object);
  const realizedIds = new Set(array(actuals.realized).map(raw => text(object(raw).scenarioId)));
  const realized = forecast.scenarios.filter(scenario => realizedIds.has(scenario.id) && !scenario.issue && scenario.home && scenario.away);
  if (realized.length !== 1) return `${forecast.eventId}: no uniquely verified realized QB scenario; hypothetical scenarios are not ranked.`;
  const scenario = realized[0], home = scenario.home, away = scenario.away;
  if (forecast.qbMatchup && scenario.id !== forecast.qbMatchup.scenarioId)
    return `${forecast.eventId}: the automatically published QB matchup was not realized; unpublished alternatives are not ranked.`;
  if (!home || !away) throw new Error('The realized scenario does not contain both teams.');
  const actualHome = teams.find(side => side.id === home.id), actualAway = teams.find(side => side.id === away.id);
  if (!actualHome || !actualAway || !finite(actualHome.points) || !finite(actualAway.points)) return `${forecast.eventId}: verified final team scores are unavailable.`;
  const published = scenario.projectedOvertime?.source === 'pregame' ? projectedSimulationScore(scenario) : null;
  const homeScore = published?.home ?? Math.round(home.score.mean), awayScore = published?.away ?? Math.round(away.score.mean);
  const issues: string[] = [], players: SimulationAccuracyPlayer[] = [];
  const comparablePlayers = forecast.version !== nflSimulationVersion || actuals.regulationOnly === true;
  if (!comparablePlayers) issues.push('Player rankings excluded: this regulation-only forecast does not have verified regulation-only actuals (overtime or verification pending).');
  let missing = 0;
  if (comparablePlayers) for (const [team, actualTeam] of [[home, actualHome], [away, actualAway]] as const) {
    for (const player of team.players) {
      if (player.issue) { missing++; continue; }
      const actualPlayer = object(object(actualTeam.players)[player.id]);
      for (const stat of Object.keys(simulationAccuracyStats) as Array<keyof SimulationStat>) {
        const projected = player.stats[stat]?.mean, actual = actualPlayer[stat];
        if (projected === undefined) continue;
        if (!finite(projected) || !finite(actual)) { missing++; continue; }
        players.push({ playerId: player.id, name: player.name, position: player.position, team: team.abbr,
          stat, projected, actual, error: Math.abs(projected - actual) });
      }
    }
  }
  if (missing) issues.push(`${missing} player/stat comparisons omitted because projections or reported actuals were unavailable; missing stats and DNPs are not treated as zero.`);
  return { eventId: forecast.eventId, kickoff: forecast.kickoff, forecastAt: forecast.forecastAt, version: forecast.version,
    settledAt, scenario: scenario.label,
    home: { id: home.id, name: home.name, abbr: home.abbr, projected: homeScore, actual: actualHome.points },
    away: { id: away.id, name: away.name, abbr: away.abbr, projected: awayScore, actual: actualAway.points },
    ...(published?.overtime ? { overtime: true } : {}),
    error: (Math.abs(homeScore - actualHome.points) + Math.abs(awayScore - actualAway.points)) / 2,
    players, issues };
}

export function buildSimulationAccuracy(scopes: SimulationAccuracyScope[], values: unknown[], now = Date.now()): SimulationAccuracyReport {
  const report: SimulationAccuracyReport = { games: [], issues: [], pending: 0 };
  for (const scope of scopes) {
    const saved = values.map(object).find(row => row.event_id === scope.eventId);
    if (!saved) {
      if (Date.parse(scope.kickoff) > now) report.pending++;
      else report.issues.push(`${scope.eventId}: no saved pregame forecast is available.`);
      continue;
    }
    if (Date.parse(text(saved.event_start)) !== Date.parse(scope.kickoff)) throw new Error('An accuracy archive does not match the requested kickoff.');
    if (saved.settled_at === null) { report.pending++; continue; }
    const settledAt = text(saved.settled_at);
    if (!Number.isFinite(Date.parse(settledAt)) || Date.parse(settledAt) < Date.parse(scope.kickoff) || Date.parse(settledAt) > now)
      throw new Error('An accuracy archive has an invalid settlement timestamp.');
    const forecast = readNFLGameSimulation(saved.payload, scope.eventId, scope.kickoff, { home: scope.homeTeamId, away: scope.awayTeamId });
    if (forecast.status !== 'ready') throw new Error('An accuracy archive is not a completed pregame forecast.');
    if (forecast.version !== saved.model_version) throw new Error('An accuracy archive has a mismatched model version.');
    const result = compareSimulationAccuracy(forecast, saved.actuals, settledAt);
    if (typeof result === 'string') report.issues.push(result);
    else report.games.push(result);
  }
  report.games.sort((a, b) => a.error - b.error || a.kickoff.localeCompare(b.kickoff) || a.eventId.localeCompare(b.eventId));
  return report;
}

export function readSimulationAccuracyReport(value: unknown, scope: SimulationAccuracyScope[]): SimulationAccuracyReport {
  const report = object(value), games = array(report.games);
  const validStrings = (values: unknown) => Array.isArray(values) && values.every(row => typeof row === 'string');
  const valid = Array.isArray(report.games) && validStrings(report.issues) && Number.isInteger(report.pending)
    && Number(report.pending) >= 0 && games.length + Number(report.pending) <= scope.length
    && new Set(games.map(raw => object(raw).eventId)).size === games.length && games.every(raw => {
      const game = object(raw), target = scope.find(row => row.eventId === game.eventId), home = object(game.home), away = object(game.away);
      return target && Date.parse(text(game.kickoff)) === Date.parse(target.kickoff)
        && home.id === target.homeTeamId && away.id === target.awayTeamId
        && [home, away].every(side => typeof side.name === 'string' && typeof side.abbr === 'string' && finite(side.projected) && finite(side.actual))
        && [game.forecastAt, game.settledAt].every(date => typeof date === 'string' && Number.isFinite(Date.parse(date)))
        && Date.parse(text(game.forecastAt)) < Date.parse(target.kickoff) && Date.parse(text(game.settledAt)) >= Date.parse(target.kickoff)
        && finite(game.error) && game.error >= 0 && typeof game.version === 'string' && typeof game.scenario === 'string'
        && (game.overtime === undefined || typeof game.overtime === 'boolean')
        && validStrings(game.issues) && Array.isArray(game.players) && game.players.every(rawPlayer => {
          const player = object(rawPlayer);
          return ['playerId', 'name', 'position', 'team'].every(key => typeof player[key] === 'string')
            && typeof player.stat === 'string' && Object.prototype.hasOwnProperty.call(simulationAccuracyStats, player.stat)
            && finite(player.projected) && finite(player.actual) && finite(player.error) && player.error >= 0;
        });
    });
  if (!valid) throw new Error('The simulation accuracy results were invalid or mismatched. Retry; no substitute results are shown.');
  return value as SimulationAccuracyReport;
}
