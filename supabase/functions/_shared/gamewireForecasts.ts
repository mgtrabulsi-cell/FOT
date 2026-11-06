import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, numeric, object, text } from './gamewaire.ts';
import { publicJSON } from './gamewaireSources.ts';
import { completedPlayerMetric } from './gamewireBotProjections.ts';
import { forecastDistribution } from './gamewireBotIntelligence.ts';
import type { BotReport, ForecastStat, PlayerForecast, PlayerWeekHistory } from './gamewireBot.ts';
import { adjustedPrediction, learnAdjustment } from './gamewireLearning.ts';
import type { LearningSample } from './gamewireLearning.ts';
import { reconcileSimulationProjections } from './nflSimulationAlignment.ts';
import type { NFLGameSimulation } from './nflSimulation.ts';

export const playerProjectionVersion = 'player-intelligence-v2';
const metrics: Record<string, { category: string; column: string }> = {
  player_pass_yds: { category: 'passing', column: 'passingYards' },
  player_rush_yds: { category: 'rushing', column: 'rushingYards' },
  player_reception_yds: { category: 'receiving', column: 'receivingYards' },
  player_receptions: { category: 'receiving', column: 'receptions' },
};
export type { PlayerForecast } from './gamewireBot.ts';

export function finalPlayerStats(summary: unknown, row: Pick<PlayerForecast, 'event_id' | 'team_id' | 'season' | 'week' | 'player_id'>,
  markets: string[]): Record<string, number | null> | null {
  const header = object(object(summary).header), competition = object(array(header.competitions)[0]);
  if (text(header.id) !== row.event_id || numeric(object(header.season).year) !== row.season
    || numeric(object(header.season).type) !== 2 || (numeric(header.week) ?? numeric(object(header.week).number)) !== row.week)
    throw new Error('The box score did not match the archived NFL game, season and week.');
  if (object(object(competition.status).type).completed !== true) return null;
  const actuals: Record<string, number | null> = {};
  for (const market of markets) {
    const metric = metrics[market];
    if (!metric) throw new Error('Unknown archived stat market.');
    actuals[market] = completedPlayerMetric(summary, row.event_id, row.team_id, row.season, metric.category, metric.column, row.player_id);
  }
  return actuals;
}

export async function settleForecasts(admin: SupabaseClient, rows: PlayerForecast[], fetcher: typeof fetch) {
  const summaries = new Map<string, Promise<unknown>>(), issues: string[] = [];
  const weeks: PlayerForecast[] = [];
  for (const row of rows) {
    if (Date.parse(row.event_start) > Date.now()) { weeks.push(row); continue; }
    try {
      let summary = summaries.get(row.event_id);
      if (!summary) {
        summary = publicJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${row.event_id}`, fetcher);
        summaries.set(row.event_id, summary);
      }
      const actuals = finalPlayerStats(await summary, row, row.projections.map(stat => stat.market));
      if (!actuals) { weeks.push(row); continue; }
      const settled_at = row.settled_at && JSON.stringify(row.actuals) === JSON.stringify(actuals) ? row.settled_at : new Date().toISOString();
      const update = await admin.from('gamewire_player_forecasts').update({ actuals, settled_at }).eq('id', row.id);
      if (update.error) throw new Error('Could not save verified final player stats.');
      weeks.push({ ...row, actuals, settled_at });
    } catch (cause) {
      console.error('Player forecast settlement failed', row.id, cause);
      issues.push(`Week ${row.week}: ${cause instanceof Error ? cause.message : 'Verified actual stats could not load.'}`);
      weeks.push(row);
    }
  }
  return { weeks, issues };
}

export async function loadPlayerHistory(admin: SupabaseClient, playerId: string, season: number, format: string, fetcher: typeof fetch): Promise<PlayerWeekHistory> {
  const saved = await admin.from('gamewire_player_forecasts').select('*').eq('player_id', playerId).eq('season', season)
    .eq('format', format).order('week', { ascending: false }).limit(18);
  if (saved.error) throw new Error('Could not read saved pregame forecasts. Retry weekly history.');
  // Recheck finals so provider corrections are reflected without changing the forecast.
  return settleForecasts(admin, saved.data as PlayerForecast[], fetcher);
}

export async function archivePlayerForecast(admin: SupabaseClient, report: BotReport, now = Date.now(), simulation?: NFLGameSimulation) {
  const game = report.matchup;
  if (!game || game.state !== 'pre' || Date.parse(game.start) <= now || !report.eligibleForGuidance) return;
  if (report.week > 18) {
    if (simulation) report.projections = reconcileSimulationProjections(report.projections, simulation, report.player.teamId, report.player.id);
    return;
  }
  report.projections = report.projections.map(stat => ({ ...stat }));
  const saved = await admin.from('gamewire_player_forecasts').select('*').eq('season', report.season).eq('position', report.player.position)
    .eq('format', report.format).eq('model_version', playerProjectionVersion).not('settled_at', 'is', null)
    .order('event_start', { ascending: false }).limit(2000);
  if (saved.error) throw new Error('Could not verify settled stat-projection learning samples.');
  const projections: ForecastStat[] = [];
  for (const projection of report.projections) {
    if (projection.estimate === null) continue;
    const base = projection.estimate, samples: LearningSample[] = [];
    for (const row of saved.data as PlayerForecast[]) {
      const stat = row.projections.find(stat => stat.market === projection.market), actual = row.actuals?.[projection.market];
      if (!stat || actual == null || !row.settled_at) continue;
      samples.push({ id: row.id, eventId: row.event_id, start: row.event_start, recordedAt: row.forecast_at,
        settledAt: row.settled_at, prediction: stat.base, actual });
    }
    const learning = learnAdjustment(samples, 'stat', now);
    const estimate = Math.round(adjustedPrediction(base, 'stat', learning.adjustment) * (projection.unit === 'receptions' ? 10 : 1)) / (projection.unit === 'receptions' ? 10 : 1);
    projection.estimate = estimate;
    projection.yards = projection.unit === 'yards' ? estimate : null;
    projection.learning = { ...learning, sampleIds: [] };
    if (projection.distribution && projection.evidence) {
      projection.distribution = forecastDistribution(estimate, projection.evidence.observations, projection.unit === 'receptions');
    }
    if (learning.active) projection.explanation += ` Bounded settled-result correction ${Math.round((learning.adjustment - 1) * 100)}%, validated on ${learning.validationGames} later games.`;
    projections.push({ market: projection.market, label: projection.label, estimate, base, learning,
      distribution: projection.distribution, defenseRank: projection.defenseRank, matchup: projection.evidence?.matchup });
  }
  if (simulation) {
    report.projections = reconcileSimulationProjections(report.projections, simulation, report.player.teamId, report.player.id);
    for (const aligned of report.projections) {
      if (!aligned?.simulation || aligned.estimate === null) continue;
      const stat = projections.find(projection => projection.market === aligned.market);
      if (stat) {
        stat.estimate = aligned.estimate;
        stat.distribution = aligned.distribution;
        stat.simulation = aligned.simulation;
      } else projections.push({ market: aligned.market, label: aligned.label, estimate: aligned.estimate, base: aligned.estimate,
        distribution: aligned.distribution, simulation: aligned.simulation });
    }
  }
  if (!projections.length) return;
  const archived = await admin.rpc('gamewire_save_forecast', { forecast: {
    player_id: report.player.id, team_id: report.player.teamId, position: report.player.position, season: report.season, week: report.week,
    format: report.format, event_id: game.eventId, event_start: game.start, opponent: game.opponent, model_version: playerProjectionVersion, projections,
  } });
  if (archived.error) throw new Error('Could not archive this pregame forecast. Retry rather than use an untracked estimate.');
  if (archived.data !== true) throw new Error('Kickoff locked the forecast before it could be saved. Refresh to see the locked game.');
}
