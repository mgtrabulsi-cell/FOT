import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, object, text } from './gamewaire.ts';
import { learnAdjustment } from './gamewireLearning.ts';
import type { LearningSample } from './gamewireLearning.ts';
import { nbaAvailabilityKey, nbaSimulationBox, nbaSimulationLockLead, nbaSimulationVersion, pendingNBASimulation, readNBAGameSimulation, readNBASimulationGame } from './nbaSimulation.ts';
import type { NBAAccuracyReport, NBAActuals, NBAGameSimulation, NBASimulationGame, NBASimulationLearning } from './nbaSimulation.ts';
import { advanceNBASimulation, nbaSimulationRosters, nbaSimulationSite, prepareNBASimulation } from './nbaSimulationSources.ts';
import type { NBASimulationJob } from './nbaSimulationSources.ts';
import type { SimulationCache } from './nflSimulationSources.ts';

type Get = (url: string) => Promise<unknown>;
export type NBASimulationScope = { eventId: string; kickoff: string; homeTeamId: string; awayTeamId: string };
const migration = 'NBA simulation storage is unavailable. Apply supabase/nba-game-simulations.sql.';
export function readNBASimulationScope(value: unknown): NBASimulationScope {
  const row = object(value), id = (value: unknown) => /^\d{1,12}$/.test(text(value));
  if (!id(row.eventId) || !id(row.homeTeamId) || !id(row.awayTeamId) || row.homeTeamId === row.awayTeamId
    || !Number.isFinite(Date.parse(text(row.kickoff)))) throw new Error('Choose a valid NBA matchup and tipoff.');
  return { eventId: text(row.eventId), kickoff: text(row.kickoff), homeTeamId: text(row.homeTeamId), awayTeamId: text(row.awayTeamId) };
}
const parse = (payload: unknown, scope: NBASimulationScope) => readNBAGameSimulation(payload, scope.eventId, scope.kickoff,
  { home: scope.homeTeamId, away: scope.awayTeamId });
export async function loadNBAGameSimulation(admin: SupabaseClient, scope: NBASimulationScope, claim: () => Promise<boolean>, now = Date.now()) {
  const saved = await admin.from('gamewire_nba_forecasts').select('payload,event_start').eq('event_id', scope.eventId)
    .eq('model_version', nbaSimulationVersion).maybeSingle();
  if (saved.error) throw new Error(migration);
  if (saved.data && Date.parse(saved.data.event_start) !== Date.parse(scope.kickoff)
    && Date.parse(saved.data.event_start) <= now) throw new Error('The original NBA forecast is locked after tipoff; a rescheduled feed cannot rewrite it.');
  const forecast = saved.data && Date.parse(saved.data.event_start) === Date.parse(scope.kickoff) ? parse(saved.data.payload, scope) : null;
  if (Date.parse(scope.kickoff) <= now) {
    if (!forecast || forecast.status !== 'ready') throw new Error('No saved pregame NBA forecast is available. Simulations are never generated after tipoff.');
    return { ...forecast, refreshing: false };
  }
  const waiting = await admin.from('gamewire_nba_simulation_jobs').select('response,last_error').eq('event_id', scope.eventId).maybeSingle();
  if (waiting.error) throw new Error('Could not read NBA simulation preparation progress.');
  if (!waiting.data && !await claim()) throw new Error('NBA simulation request limit reached. Retry in a minute.');
  const queued = await admin.rpc('gamewire_queue_nba_simulations', { games: [{ event_id: scope.eventId, event_start: scope.kickoff }] });
  if (queued.error) throw new Error('Could not queue the NBA simulation.');
  if (forecast) return { ...forecast, refreshing: !forecast.lockedAt && (forecast.refreshing || Date.parse(forecast.forecastAt!) < now - 10 * 60000),
    warnings: [...forecast.warnings, ...(waiting.data?.last_error ? [`Refresh delayed: ${waiting.data.last_error}`] : [])] };
  if (waiting.data?.last_error) throw new Error(`NBA simulation preparation delayed: ${waiting.data.last_error}`);
  if (waiting.data?.response) return parse(waiting.data.response, scope);
  return { ...pendingNBASimulation({ id: scope.eventId, date: scope.kickoff, season: new Date(scope.kickoff).getUTCFullYear(),
    seasonType: 2, home: { id: scope.homeTeamId, name: '', abbr: '' }, away: { id: scope.awayTeamId, name: '', abbr: '' } }, now),
    stage: 'Queued · waiting for verified NBA matchup and historical stats' };
}
async function loadLearning(admin: SupabaseClient, now: number): Promise<NBASimulationLearning> {
  const rows = await admin.from('gamewire_nba_forecasts').select('event_id,event_start,forecast_at,settled_at,payload,actuals')
    .eq('model_version', nbaSimulationVersion).not('settled_at', 'is', null).lt('settled_at', new Date(now).toISOString())
    .order('event_start', { ascending: false }).limit(160);
  if (rows.error) throw new Error('Could not load verified NBA simulation learning history.');
  const score: LearningSample[] = [], pra: LearningSample[] = [];
  for (const row of rows.data ?? []) {
    const forecast = row.payload as NBAGameSimulation, actuals = row.actuals as NBAActuals | null;
    if (!forecast.baseline || !actuals) continue;
    const sample = { id: row.event_id, eventId: row.event_id, start: row.event_start, recordedAt: row.forecast_at, settledAt: row.settled_at };
    const scorePairs = [{ prediction: forecast.baseline.homeScore, actual: actuals.home.score },
      { prediction: forecast.baseline.awayScore, actual: actuals.away.score }];
    score.push({ ...sample, prediction: scorePairs[0].prediction, actual: scorePairs[0].actual, observations: scorePairs });
    const pairs = forecast.baseline.players.flatMap(player => {
      const actual = [actuals.home, actuals.away].find(team => team.id === player.teamId)?.players[player.id];
      return actual && actual.minutes > 0 ? [{ prediction: player.pra, actual: actual.points + actual.rebounds + actual.assists }] : [];
    });
    if (pairs.length) pra.push({ ...sample, prediction: pairs[0].prediction, actual: pairs[0].actual, observations: pairs });
  }
  return { score: learnAdjustment(score, 'stat', now), pra: learnAdjustment(pra, 'stat', now) };
}
export async function runNBAGameSimulation(admin: SupabaseClient, eventId: string, get: Get, now = Date.now()) {
  const token = crypto.randomUUID();
  const lease = await admin.rpc('gamewire_claim_nba_simulation', { target_event: eventId, target_token: token });
  if (lease.error) throw new Error('Could not claim NBA simulation work.');
  if (lease.data !== true) return null;
  try {
    const raw = await get(`${nbaSimulationSite}/summary?event=${eventId}`), game = readNBASimulationGame(raw, eventId);
    if (Date.parse(game.date) <= now || text(object(object(object(array(object(object(raw).header).competitions)[0]).status).type).state) !== 'pre')
      throw new Error('NBA game has started or is not scheduled for pregame preparation.');
    const scope = { eventId, kickoff: game.date, homeTeamId: game.home.id, awayTeamId: game.away.id };
    const [existing, work, roster] = await Promise.all([
      admin.from('gamewire_nba_forecasts').select('payload').eq('event_id', eventId).eq('model_version', nbaSimulationVersion).maybeSingle(),
      admin.from('gamewire_nba_simulation_jobs').select('payload').eq('event_id', eventId).eq('lease_token', token).single(),
      nbaSimulationRosters(game, get),
    ]);
    if (existing.error || work.error) throw new Error('Could not read NBA simulation work state.');
    const previous = existing.data && Date.parse(text(object(existing.data.payload).kickoff)) === Date.parse(game.date)
      ? parse(existing.data.payload, scope) : null;
    const frozen = now >= Date.parse(game.date) - nbaSimulationLockLead;
    let result: NBAGameSimulation, job = work.data.payload as NBASimulationJob | null;
    if (previous?.status === 'ready' && frozen && previous.availabilityKey === nbaAvailabilityKey(roster)) {
      result = { ...previous, lockedAt: previous.lockedAt ?? new Date(now).toISOString(), refreshing: false };
    } else {
      const cache: SimulationCache = {
        readMany: async <T>(keys: string[]) => {
          const map = new Map<string, T>();
          for (let start = 0; start < keys.length; start += 200) {
            const rows = await admin.from('gamewire_bot_cache').select('cache_key,payload').in('cache_key', keys.slice(start, start + 200))
              .gt('expires_at', new Date(now).toISOString());
            if (rows.error) throw new Error('Could not read NBA simulation evidence cache.');
            for (const row of rows.data ?? []) map.set(row.cache_key, row.payload as T);
          }
          return map;
        },
        write: async (key, payload, ttl) => {
          const row = await admin.from('gamewire_bot_cache').upsert({ cache_key: key, payload, expires_at: new Date(Date.now() + ttl).toISOString() });
          if (row.error) throw new Error('Could not persist NBA simulation evidence.');
        },
      };
      if (!job || Date.parse(job.createdAt) < now - 10 * 60000) job = await prepareNBASimulation(game, get, cache, now);
      const learning = await loadLearning(admin, now);
      result = (await advanceNBASimulation(game, job, get, cache, roster, now, learning)).result;
    }
    if (result.status === 'ready') {
      const verified = readNBASimulationGame(await get(`${nbaSimulationSite}/summary?event=${eventId}`), eventId);
      if (Date.parse(verified.date) !== Date.parse(game.date) || verified.home.id !== game.home.id || verified.away.id !== game.away.id)
        throw new Error('NBA matchup changed during preparation. Retry with the updated schedule.');
      const saved = await admin.rpc('gamewire_save_nba_simulation', { target_token: token, forecast: result });
      if (saved.error || !saved.data) throw new Error('Could not archive NBA forecast: tipoff or the work lease changed.');
      result = parse(saved.data, scope);
    }
    const updated = await admin.from('gamewire_nba_simulation_jobs').update({ payload: job, response: result, last_error: null,
      event_start: game.date, attempts: 0, updated_at: new Date().toISOString(),
      next_run_at: new Date(Math.min(Date.now() + (frozen || result.status === 'collecting' || result.refreshing ? 60000 : 10 * 60000),
        Math.max(Date.now() + 1000, Date.parse(game.date) - nbaSimulationLockLead))).toISOString() })
      .eq('event_id', eventId).eq('lease_token', token).select('event_id');
    if (updated.error || updated.data?.length !== 1) throw new Error('Could not save NBA simulation progress.');
    return result;
  } catch (cause) {
    console.error('NBA simulation preparation failed', eventId, cause);
    const failed = await admin.rpc('gamewire_fail_nba_simulation', { target_event: eventId, target_token: token,
      failure: cause instanceof Error ? cause.message : 'NBA simulation preparation failed.' });
    if (failed.error) throw new Error('NBA simulation failed and retry state could not be saved.', { cause });
    throw cause;
  } finally {
    const released = await admin.from('gamewire_nba_simulation_jobs').update({ lease_token: null, lease_until: new Date().toISOString(), dispatched_at: null })
      .eq('event_id', eventId).eq('lease_token', token);
    if (released.error) throw new Error('Could not release NBA simulation work lease.');
  }
}
export async function warmNBAGameSimulations(admin: SupabaseClient, get: Get, now = Date.now()) {
  const compact = (value: number) => new Date(value).toISOString().slice(0, 10).replace(/-/g, '');
  const dates = Array.from({ length: 16 }, (_, i) => compact(now + (i - 1) * 86400000));
  const boards: Record<string, unknown>[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < dates.length) {
      const date = dates[next++];
      const raw = object(await get(`${nbaSimulationSite}/scoreboard?dates=${date}&limit=1000`));
      if (!Array.isArray(raw.events)) throw new Error(`NBA discovery scoreboard is unavailable for ${date}.`);
      boards.push(raw);
    }
  }));
  const games = [...new Map(boards.flatMap(raw => array(raw.events).map(object).filter(event => {
    const competition = object(array(event.competitions)[0]), phase = Number(object(event.season).type ?? object(raw.season).type);
    return /^\d{1,12}$/.test(text(event.id)) && [2, 3].includes(phase) && object(object(competition.status).type).state === 'pre'
      && Date.parse(text(event.date)) > now && Date.parse(text(event.date)) <= now + 14 * 86400000;
  })).map(event => [text(event.id), { event_id: text(event.id), event_start: text(event.date) }])).values()];
  const queued = await admin.rpc('gamewire_queue_nba_simulations', { games });
  if (queued.error) throw new Error('Could not queue upcoming NBA simulations.');
  return { queued: games.length };
}
export async function settleNBAGameSimulations(admin: SupabaseClient, get: Get, now = Date.now()) {
  const pending = await admin.from('gamewire_nba_forecasts').select('event_id,event_start,payload').is('settled_at', null)
    .lt('event_start', new Date(now).toISOString()).gt('event_start', new Date(now - 21 * 86400000).toISOString()).order('event_start').limit(40);
  if (pending.error) throw new Error('Could not load pending NBA simulation results.');
  let settled = 0;
  const issues: string[] = [];
  for (const row of pending.data ?? []) {
    try {
      const raw = await get(`${nbaSimulationSite}/summary?event=${row.event_id}`);
      const competition = object(array(object(object(raw).header).competitions)[0]);
      if (object(object(competition.status).type).completed !== true) continue;
      const forecast = row.payload as NBAGameSimulation, game = readNBASimulationGame(raw, row.event_id);
      if (Date.parse(game.date) !== Date.parse(row.event_start) || game.home.id !== forecast.homeTeamId
        || game.away.id !== forecast.awayTeamId || game.season !== forecast.season || game.seasonType !== forecast.seasonType)
        throw new Error('Final NBA matchup does not match the pregame archive.');
      const rows = nbaSimulationBox(raw, row.event_id, now);
      const actual = (id: string) => {
        const side = rows.find(row => row.teamId === id);
        if (!side) throw new Error('NBA final team identity is missing.');
        return { id, score: side.points, players: side.players };
      };
      const actuals: NBAActuals = { home: actual(game.home.id), away: actual(game.away.id) };
      if (actuals.home.score === actuals.away.score) throw new Error('A tied NBA score is not a verified final.');
      const saved = await admin.from('gamewire_nba_forecasts').update({ actuals, settled_at: new Date(now).toISOString() })
        .eq('event_id', row.event_id).eq('model_version', nbaSimulationVersion).is('settled_at', null);
      if (saved.error) throw new Error('Could not persist verified NBA final results.');
      settled++;
    } catch (cause) {
      console.error('NBA simulation settlement failed', row.event_id, cause);
      issues.push(`${row.event_id}: ${cause instanceof Error ? cause.message : 'Final results unavailable.'}`);
    }
  }
  return { settled, issues };
}
export async function loadNBAAccuracy(admin: SupabaseClient, scopes: NBASimulationScope[]): Promise<NBAAccuracyReport> {
  const rows = await admin.from('gamewire_nba_forecasts').select('event_id,event_start,payload,actuals,settled_at')
    .in('event_id', scopes.map(row => row.eventId)).eq('model_version', nbaSimulationVersion).limit(64);
  if (rows.error) throw new Error('Could not load NBA simulation results.');
  return { games: scopes.flatMap(scope => {
    const row = rows.data?.find(row => row.event_id === scope.eventId && Date.parse(row.event_start) === Date.parse(scope.kickoff));
    return row ? [{ eventId: scope.eventId, kickoff: scope.kickoff, forecast: parse(row.payload, scope),
      actuals: row.actuals as NBAActuals | null, settledAt: row.settled_at }] : [];
  }), issues: scopes.filter(scope => !rows.data?.some(row => row.event_id === scope.eventId
    && Date.parse(row.event_start) === Date.parse(scope.kickoff))).map(scope => `${scope.eventId}: no pregame forecast archived.`) };
}
