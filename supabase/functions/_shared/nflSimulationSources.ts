import { array, object, text } from './gamewaire.ts';
import { readBotDepth } from './gamewireBotProjections.ts';
import { readBotRoster } from './gamewireBot.ts';
import { nflSimulationRuns, nflSimulationVersion, simulateNFLGame, simulationBox, simulationObservations, simulationPlayerLogs, simulationPlayerSeasons, simulationSchedule } from './nflSimulation.ts';
import type { NFLGameSimulation, SimulationBox, SimulationGame, SimulationPlayer, SimulationReference } from './nflSimulation.ts';

const site = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const logs = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes';
const day = 86400000;
export type SimulationCache = {
  readMany: <T>(keys: string[]) => Promise<Map<string, T>>;
  write: (key: string, value: unknown, ttl: number) => Promise<void>;
};
export type SimulationJob = {
  version: string; createdAt: string; history: { home: SimulationReference[]; away: SimulationReference[] };
  rosterPlayers: SimulationPlayer[]; players: SimulationPlayer[] | null; injuries: NFLGameSimulation['injuries'];
  warnings: string[]; logs: Record<string, { season: number; refs: SimulationReference[]; done: boolean }>;
};
const boxKey = (id: string) => `nfl:simulation:box:v2:${id}`;
const unique = (refs: SimulationReference[]) => [...new Map(refs.map(row => [row.id, row])).values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Verified simulation evidence is unavailable.';
async function resource<T>(key: string, cache: SimulationCache, ttl: number, load: () => Promise<T>): Promise<T> {
  const saved = (await cache.readMany<T>([key])).get(key);
  if (saved !== undefined) return saved;
  const value = await load();
  await cache.write(key, value, ttl);
  return value;
}
export async function prepareSimulation(game: SimulationGame, get: (url: string) => Promise<unknown>, cache: SimulationCache, now: number): Promise<SimulationJob> {
  const cutoff = Math.min(now, Date.parse(game.date));
  const history = async (teamId: string) => {
    let refs: SimulationReference[] = [];
    for (let year = game.season; year >= game.season - 8 && refs.length < 100; year--) {
      const phases = await Promise.all(([2, 3] as const).map(phase => resource(
        `nfl:simulation:schedule:v1:${teamId}:${year}:${phase}`, cache, year === game.season ? 5 * 60000 : 365 * day,
        () => get(`${site}/teams/${teamId}/schedule?season=${year}&seasontype=${phase}&limit=1000`)
          .then(raw => simulationSchedule(raw, teamId, year, phase, cutoff)))));
      refs = unique([...refs, ...phases.flat()]).filter(ref => Date.parse(ref.date) < cutoff);
    }
    if (refs.length < 100) throw new Error(`${teamId}: only ${refs.length}/100 verified completed regular-season/playoff games could be found. No smaller sample is presented as a 100-game simulation.`);
    return refs.slice(0, 100);
  };
  const warnings: string[] = [], injuries: NFLGameSimulation['injuries'] = [];
  const roster = async (team: SimulationGame['home']) => {
    const raw = await get(`${site}/teams/${team.id}/roster?season=${game.season}`);
    const rawTeam = text(object(object(raw).team).id);
    if (rawTeam && rawTeam !== team.id) throw new Error('Simulation roster returned a different team.');
    const listed = array(object(raw).athletes).flatMap(entry => Array.isArray(object(entry).items) ? array(object(entry).items) : [entry]).map(object);
    let depth: unknown = null;
    try { depth = await get(`${site}/teams/${team.id}/depthcharts`); }
    catch (cause) { console.error('Simulation depth chart unavailable', team.id, cause); warnings.push(`${team.abbr}: depth chart unavailable; candidates use recorded usage, not confirmed starters.`); }
    const availability = (id: string) => {
      const row = listed.find(player => text(player.id) === id);
      if (!row) throw new Error('A simulation player could not be matched to the current roster.');
      const reported = array(row.injuries).map(injury => text(object(injury).status)).filter(Boolean);
      const status = [...reported, text(object(row.status).name) || text(object(row.status).type)].filter(Boolean).join(' / ') || 'Availability unverified';
      const excluded = /\b(out|inactive|suspended|injured reserve|ir|reserve\/injured|non-football)\b/i.test(status);
      const uncertain = excluded || reported.length > 0 || !/\bactive\b/i.test(status);
      return { status, excluded, uncertain };
    };
    for (const row of listed) {
      const status = availability(text(row.id));
      if (status.uncertain) injuries.push({ name: text(row.displayName), position: text(object(row.position).abbreviation), teamId: team.id, status: status.status });
    }
    return readBotRoster(raw, team).map(player => {
      let role = 'Recorded-usage candidate; not a confirmed starter';
      if (depth !== null) {
        try {
          const rank = readBotDepth(depth, player);
          if (rank) role = `Depth-chart rank ${rank.rank}; not a confirmed game-day starter`;
        } catch (cause) {
          console.error('Simulation depth role unverified', player.id, cause);
          if (!warnings.some(warning => warning.startsWith(`${team.abbr}: depth role`))) warnings.push(`${team.abbr}: depth role could not be verified; recorded usage is used.`);
        }
      }
      return { ...player, ...availability(player.id), role };
    });
  };
  const [home, away, homePlayers, awayPlayers] = await Promise.all([history(game.home.id), history(game.away.id), roster(game.home), roster(game.away)]);
  return { version: nflSimulationVersion, createdAt: new Date(now).toISOString(), history: { home, away },
    rosterPlayers: [...homePlayers, ...awayPlayers], players: null, injuries, warnings, logs: {} };
}
function selectPlayers(job: SimulationJob, boxes: Map<string, SimulationBox>): SimulationPlayer[] {
  return [job.history.home, job.history.away].flatMap(refs => {
    const teamId = refs[0].teamId;
    const usage = (player: SimulationPlayer) => {
      const values = refs.slice(0, 5).flatMap(ref => {
        const observed = boxes.get(ref.id)?.teams.find(team => team.id === teamId)?.players[player.id];
        if (!observed) return [];
        return [player.position === 'QB' ? observed.passingAttempts ?? 0 : player.position === 'RB'
          ? (observed.rushingAttempts ?? 0) + (observed.receptions ?? 0) : observed.receptions ?? 0];
      });
      return values.reduce((a, b) => a + b, 0);
    };
    const rank = (player: SimulationPlayer) => Number(player.role.match(/rank (\d+)/)?.[1] ?? 100);
    return (['QB', 'RB', 'WR', 'TE'] as const).flatMap(position => {
      const candidates = job.rosterPlayers.filter(p => p.teamId === teamId && p.position === position)
        .sort((a, b) => Number(a.excluded) - Number(b.excluded) || rank(a) - rank(b) || usage(b) - usage(a) || a.id.localeCompare(b.id));
      const limit = position === 'QB' ? 3 : position === 'WR' ? 4 : 2;
      const selected = candidates.slice(0, limit);
      // Keep reported unavailable depth leaders visible, without treating their missing future production as zero.
      return [...new Map([...selected, ...candidates.filter(p => p.excluded && rank(p) === 1)].map(p => [p.id, p])).values()];
    });
  });
}
async function boxBatch(refs: SimulationReference[], cache: SimulationCache, get: (url: string) => Promise<unknown>, now: number) {
  const required = unique(refs), keys = required.map(ref => boxKey(ref.id)), saved = await cache.readMany<SimulationBox>(keys);
  const missing = required.filter(ref => !saved.has(boxKey(ref.id))), issues: string[] = [];
  const deadline = Date.now() + 24000;
  for (let start = 0; start < Math.min(36, missing.length) && Date.now() < deadline; start += 6) {
    await Promise.all(missing.slice(start, start + 6).map(async ref => {
      let box: SimulationBox;
      try {
        box = simulationBox(await get(`${site}/summary?event=${ref.id}`), ref.id, now);
        if (box.season !== ref.season || box.seasonType !== ref.seasonType || Date.parse(box.date) !== Date.parse(ref.date)
          || !box.teams.some(team => team.id === ref.teamId) || !box.teams.some(team => team.id === ref.opponentId))
          throw new Error('Historical summary does not match its verified schedule/player appearance.');
      } catch (cause) {
        console.error('Simulation historical box unavailable', ref.id, cause);
        issues.push(`${ref.id}: ${message(cause)}`); return;
      }
      await cache.write(boxKey(ref.id), box, 365 * day);
      saved.set(boxKey(ref.id), box);
    }));
  }
  return { boxes: new Map(required.flatMap(ref => {
    const box = saved.get(boxKey(ref.id));
    return box ? [[ref.id, box] as const] : [];
  })), completed: saved.size, total: required.length, issues };
}
export async function advanceSimulation(game: SimulationGame, job: SimulationJob, cache: SimulationCache, get: (url: string) => Promise<unknown>, now: number): Promise<NFLGameSimulation> {
  const result: NFLGameSimulation = { status: 'collecting', version: nflSimulationVersion, eventId: game.id, kickoff: game.date, checkedAt: job.createdAt,
    forecastAt: null, stage: 'Team history', progress: { completed: 0, total: 200 }, history: { home: 100, away: 100, target: 100 },
    runs: nflSimulationRuns, calibrated: false, warnings: [...job.warnings], injuries: job.injuries, scenarios: [] };
  const teamRefs = [...job.history.home, ...job.history.away], teamBatch = await boxBatch(teamRefs, cache, get, now);
  result.progress = { completed: teamBatch.completed, total: teamBatch.total };
  result.history.home = job.history.home.filter(ref => teamBatch.boxes.has(ref.id)).length;
  result.history.away = job.history.away.filter(ref => teamBatch.boxes.has(ref.id)).length;
  result.warnings.push(...teamBatch.issues);
  if (teamBatch.completed < teamBatch.total) return result;
  job.players ??= selectPlayers(job, teamBatch.boxes);
  const active = job.players.filter(player => !player.excluded);
  const work = active.filter(player => !job.logs[player.id]?.done)
    .sort((a, b) => (job.logs[b.id]?.season ?? game.season) - (job.logs[a.id]?.season ?? game.season));
  result.stage = 'Cross-team player history';
  for (let start = 0; start < Math.min(12, work.length); start += 6) await Promise.all(work.slice(start, start + 6).map(async player => {
    const state = job.logs[player.id] ??= { season: game.season, refs: [], done: false };
    let evidence: { refs: SimulationReference[]; seasons: number[] };
    try {
      evidence = await resource(`nfl:simulation:logs:v2:${player.id}:${state.season}:${player.position}`, cache, state.season === game.season ? 5 * 60000 : 365 * day,
        () => get(`${logs}/${player.id}/gamelog?season=${state.season}`).then(raw => ({
          refs: simulationPlayerLogs(raw, state.season, now, player.position === 'QB'), seasons: simulationPlayerSeasons(raw, state.season),
        })));
    } catch (cause) {
      console.error('Simulation cross-team logs unavailable', player.id, state.season, cause);
      result.warnings.push(`${player.name} (${state.season}): ${message(cause)}`); return;
    }
    state.refs = unique([...state.refs, ...evidence.refs]).filter(ref => Date.parse(ref.date) < now).slice(0, 60);
    const earlier = evidence.seasons.filter(year => year < state.season && year >= game.season - 8).sort((a, b) => b - a);
    if (state.refs.length >= 30 || state.season <= game.season - 8 || evidence.seasons.length > 0 && !earlier.length) state.done = true;
    else state.season = earlier[0] ?? state.season - 1;
  }));
  result.progress = { completed: active.filter(player => job.logs[player.id]?.done).length, total: active.length };
  if (active.some(player => !job.logs[player.id]?.done)) return result;
  const refs = active.flatMap(player => job.logs[player.id].refs), playerBatch = await boxBatch([...teamRefs, ...refs], cache, get, now);
  result.stage = 'Player production and defensive matchups';
  result.progress = { completed: playerBatch.completed, total: playerBatch.total };
  result.warnings.push(...playerBatch.issues);
  if (playerBatch.completed < playerBatch.total) return result;
  const observations = new Map(active.map(player => [player.id, simulationObservations(player, job.logs[player.id].refs, playerBatch.boxes, now, issue => {
    console.error('Simulation player observation excluded', issue);
    result.warnings.push(issue);
  })]));
  result.scenarios = simulateNFLGame(game, {
    home: job.history.home.map(ref => playerBatch.boxes.get(ref.id)!),
    away: job.history.away.map(ref => playerBatch.boxes.get(ref.id)!),
  }, job.players, observations, result.runs);
  result.status = result.scenarios.some(scenario => scenario.home && scenario.away) ? 'ready' : 'unavailable';
  result.forecastAt = new Date(now).toISOString();
  result.stage = result.status === 'ready' ? 'Simulation complete' : 'Insufficient quarterback evidence';
  result.warnings.push(
    'Experimental joint empirical bootstrap; probabilities and 10th–90th percentile ranges are not calibrated or betting recommendations.',
    'Team history: exactly 100 completed regular-season/playoff games, recency half-life 24 games; matching home/away history receives 1.5× weight.',
    'Player history: up to 30 verified production appearances across teams; recency half-life 10 appearances and same-opponent samples receive 1.5× weight.',
    'Defensive adjustments use observed passing/rushing yards per opportunity and points per yard, relative to historical opponent samples; coefficients are heuristic, not fitted injury effects.',
    'Every QB pairing is conditional, not a confirmed starter. Skill-player markets require eight recorded category appearances and assume listed questionable players participate at observed usage.',
    'Reported out/inactive players are excluded from current allocations. Unmodeled players retain a team remainder; no specific injured-player replacement or numerical OL/defensive injury penalty is invented.',
    'Touchdowns use verified per-opportunity player production and opponent allowances. Passing/receiving touchdowns reconcile and scoring is bounded below by six points per offensive touchdown in every draw.',
    'Scores use joint yardage/scoring-rate outcomes, not drive-by-drive, kicker or overtime simulations. Rounded box-score lines are reconciled; expand details for expectations and uncalibrated ranges.',
  );
  return result;
}
