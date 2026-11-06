import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, numeric, object, text } from './gamewaire.ts';
import { nflSimulationRuns, nflSimulationVersion, simulationBox, simulationGame } from './nflSimulation.ts';
import type { NFLGameSimulation } from './nflSimulation.ts';
import { advanceSimulation, prepareSimulation } from './nflSimulationSources.ts';
import type { SimulationCache, SimulationJob } from './nflSimulationSources.ts';
import { currentBotWeek, readBotWeek } from './gamewireBot.ts';

const site = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const migration = 'NFL simulation storage is unavailable. Apply supabase/nfl-game-simulations.sql before enabling this endpoint.';
export async function loadNFLGameSimulation(admin: SupabaseClient, eventId: string, get: (url: string) => Promise<unknown>,
  claim: () => Promise<boolean>, now = Date.now()): Promise<NFLGameSimulation> {
  const game = simulationGame(await get(`${site}/summary?event=${eventId}`), eventId, now);
  const snapshot = await admin.from('gamewire_game_forecasts').select('payload,event_start').eq('event_id', eventId).eq('model_version', nflSimulationVersion).maybeSingle();
  if (snapshot.error) throw new Error(migration);
  const saved = snapshot.data?.payload as NFLGameSimulation | undefined;
  if (snapshot.data && Date.parse(snapshot.data.event_start) <= now) throw new Error('This game’s original forecast is locked after kickoff, even if the feed reschedules it.');
  if (saved?.status === 'ready' && saved.kickoff === game.date && Date.parse(saved.forecastAt ?? '') > now - 5 * 60000) return saved;
  const token = crypto.randomUUID();
  const locked = await admin.rpc('gamewire_claim_simulation', { target_event: eventId, target_token: token });
  if (locked.error) throw new Error(migration);
  if (locked.data !== true) {
    const waiting = await admin.from('gamewire_simulation_jobs').select('response').eq('event_id', eventId).maybeSingle();
    if (waiting.error) throw new Error('Could not read NFL simulation progress.');
    const response = waiting.data?.response as NFLGameSimulation | null;
    if (response) return { ...response, status: 'collecting', forecastAt: null, scenarios: [], stage: 'Shared backfill in progress' };
    return { status: 'collecting', version: nflSimulationVersion, eventId, kickoff: game.date, checkedAt: new Date(now).toISOString(),
      forecastAt: null, stage: 'Preparing shared NFL history', progress: { completed: 0, total: 200 }, history: { home: 0, away: 0, target: 100 },
      runs: nflSimulationRuns, calibrated: false, warnings: [], injuries: [], scenarios: [] };
  }
  try {
    if (!await claim()) throw new Error('Simulation refresh limit reached (60 per account per hour). Shared background backfill continues; retry after the hour changes.');
    const row = await admin.from('gamewire_simulation_jobs').select('payload,response').eq('event_id', eventId).maybeSingle();
    if (row.error) throw new Error('Could not load the saved NFL simulation work.');
    const cache: SimulationCache = {
      readMany: async <T>(keys: string[]) => {
        const result = new Map<string, T>();
        for (let start = 0; start < keys.length; start += 200) {
          const rows = await admin.from('gamewire_bot_cache').select('cache_key,payload').in('cache_key', keys.slice(start, start + 200)).gt('expires_at', new Date(now).toISOString());
          if (rows.error) throw new Error('Could not read verified NFL simulation evidence.');
          for (const item of rows.data ?? []) result.set(item.cache_key, item.payload as T);
        }
        return result;
      },
      write: async (key, payload, ttl) => {
        const written = await admin.from('gamewire_bot_cache').upsert({ cache_key: key, payload, expires_at: new Date(Date.now() + ttl).toISOString() });
        if (written.error) throw new Error('Could not persist NFL simulation evidence. Retry; unsaved data is not presented as a complete backfill.');
      },
    };
    let job = row.data?.payload as SimulationJob | null;
    if (!job || job.version !== nflSimulationVersion || Date.parse(job.createdAt) < now - 5 * 60000) {
      const previous = job;
      job = await prepareSimulation(game, get, cache, now);
      if (previous?.version === nflSimulationVersion) {
        job.logs = previous.logs;
        if (['ready', 'unavailable'].includes(text(object(row.data?.response).status))) {
          for (const state of Object.values(job.logs)) { state.season = game.season; state.done = false; }
        }
      }
    }
    let result = await advanceSimulation(game, job, cache, get, now);
    if (result.status === 'ready') {
      const verified = simulationGame(await get(`${site}/summary?event=${eventId}`), eventId, Date.now());
      if (verified.date !== game.date || verified.home.id !== game.home.id || verified.away.id !== game.away.id) throw new Error('The matchup changed during simulation. Retry with the updated schedule.');
      const archived = await admin.rpc('gamewire_save_game_simulation', { target_token: token, forecast: {
        event_id: game.id, event_start: game.date, season: game.season, season_type: game.seasonType, model_version: nflSimulationVersion, payload: result,
      } });
      if (archived.error) throw new Error('Could not archive the pregame simulation. Retry rather than use an untracked forecast.');
      if (!archived.data) throw new Error('The game started or the simulation lease changed before the forecast could be archived.');
      result = archived.data as NFLGameSimulation;
    }
    const updated = await admin.from('gamewire_simulation_jobs').update({ payload: job, response: result, updated_at: new Date().toISOString() })
      .eq('event_id', eventId).eq('lease_token', token).select('event_id');
    if (updated.error || updated.data?.length !== 1) throw new Error('Could not save NFL simulation progress. Verified resources remain cached; retry.');
    return result;
  } finally {
    const released = await admin.from('gamewire_simulation_jobs').update({ lease_token: null, lease_until: new Date().toISOString() }).eq('event_id', eventId).eq('lease_token', token);
    if (released.error) throw new Error('Could not release the NFL simulation work lease. Retry after two minutes.');
  }
}
export async function warmNFLGameSimulations(admin: SupabaseClient, get: (url: string) => Promise<unknown>, now = Date.now()) {
  const current = await get(`${site}/scoreboard`), target = currentBotWeek(current, new Date(now));
  if (![2, 3].includes(target.seasonType)) return { eventId: null, stage: 'No upcoming regular-season/playoff NFL games', issues: [] };
  const weeks = [0, 1, 2].map(offset => ({ week: target.week + offset, phase: target.seasonType }))
    .filter(scope => scope.week <= (scope.phase === 2 ? 18 : 5));
  if (target.seasonType === 2 && target.week >= 17) weeks.push({ week: 1, phase: 3 }, { week: 2, phase: 3 });
  const boards = await Promise.all(weeks.map(async scope => {
    const board = await get(`${site}/scoreboard?dates=${target.season}&seasontype=${scope.phase}&week=${scope.week}&limit=1000`);
    const reported = readBotWeek(board);
    if (reported.season !== target.season || reported.seasonType !== scope.phase || reported.week !== scope.week)
      throw new Error('Simulation warm-up scoreboard returned a different NFL season, phase or week.');
    return board;
  }));
  const upcoming = [...new Map(boards.flatMap(board => array(object(board).events).map(object).filter(event => {
    const competition = object(array(event.competitions)[0]), state = text(object(object(competition.status).type).state);
    const phase = numeric(object(event.season).type) ?? numeric(object(event.seasonType).type) ?? numeric(object(object(board).season).type);
    return /^\d{1,12}$/.test(text(event.id)) && state === 'pre' && Date.parse(text(event.date)) > now
      && Date.parse(text(event.date)) <= now + 14 * 86400000 && [2, 3].includes(phase ?? 0);
  })).map(event => [text(event.id), event])).values()];
  if (!upcoming.length) return { eventId: null, stage: 'No upcoming NFL games', issues: [] };
  const jobs = await admin.from('gamewire_simulation_jobs').select('event_id,response,updated_at').in('event_id', upcoming.map(event => text(event.id)));
  if (jobs.error) throw new Error(migration);
  const byId = new Map((jobs.data ?? []).map(row => [row.event_id, row]));
  const pending = upcoming.filter(event => !['ready', 'unavailable'].includes(text(object(byId.get(text(event.id))?.response).status)));
  const choices = pending.length ? pending : upcoming;
  choices.sort((a, b) => Date.parse(byId.get(text(a.id))?.updated_at ?? '1970-01-01') - Date.parse(byId.get(text(b.id))?.updated_at ?? '1970-01-01'));
  const eventId = text(choices[0].id);
  const result = await loadNFLGameSimulation(admin, eventId, get, async () => true, now);
  return { eventId, stage: result.stage, progress: result.progress, issues: result.warnings.filter(warning => /^\d+:/.test(warning)) };
}
export async function settleNFLGameSimulations(admin: SupabaseClient, get: (url: string) => Promise<unknown>, now = Date.now()) {
  const pending = await admin.from('gamewire_game_forecasts').select('event_id,event_start,payload,model_version,season,season_type').is('settled_at', null)
    .lt('event_start', new Date(now).toISOString()).gt('event_start', new Date(now - 21 * 86400000).toISOString()).order('event_start').limit(40);
  if (pending.error) throw new Error(migration);
  const issues: string[] = [];
  let settled = 0;
  for (const row of pending.data ?? []) {
    let box;
    try {
      const raw = await get(`${site}/summary?event=${row.event_id}`);
      const header = object(object(raw).header), competition = object(array(header.competitions)[0]);
      if (object(object(competition.status).type).completed !== true) continue;
      box = simulationBox(raw, row.event_id, now);
    } catch (cause) { console.error('Game simulation settlement source failed', row.event_id, cause); issues.push(`${row.event_id}: ${cause instanceof Error ? cause.message : 'Final stats unavailable.'}`); continue; }
    if (Date.parse(box.date) !== Date.parse(row.event_start) || box.season !== row.season || box.seasonType !== row.season_type) {
      issues.push(`${row.event_id}: final kickoff/season/phase does not match the archived game.`); continue;
    }
    const forecast = row.payload as NFLGameSimulation;
    const sample = forecast.scenarios.find(scenario => scenario.home && scenario.away);
    if (!sample || !box.teams.some(side => side.id === sample.home!.id) || !box.teams.some(side => side.id === sample.away!.id)) {
      issues.push(`${row.event_id}: final teams do not match the archived game.`); continue;
    }
    const realized = forecast.scenarios.filter(scenario => {
      const ids = scenario.id.split(':');
      return scenario.home && scenario.away
        && (box.teams.find(side => side.id === scenario.home!.id)?.players[ids[0]]?.passingAttempts ?? 0) >= 10
        && (box.teams.find(side => side.id === scenario.away!.id)?.players[ids[1]]?.passingAttempts ?? 0) >= 10;
    }).map(scenario => {
      const home = box.teams.find(side => side.id === scenario.home!.id)!, away = box.teams.find(side => side.id === scenario.away!.id)!;
      return { scenarioId: scenario.id, homeScoreError: scenario.home!.score.mean - home.points, awayScoreError: scenario.away!.score.mean - away.points,
        meanAbsoluteScoreError: (Math.abs(scenario.home!.score.mean - home.points) + Math.abs(scenario.away!.score.mean - away.points)) / 2 };
    });
    const saved = await admin.from('gamewire_game_forecasts').update({ actuals: { teams: box.teams, realized }, settled_at: new Date(now).toISOString() })
      .eq('event_id', row.event_id).eq('model_version', row.model_version).is('settled_at', null);
    if (saved.error) throw new Error('Could not save verified NFL simulation results.');
    settled++;
  }
  return { settled, issues };
}
