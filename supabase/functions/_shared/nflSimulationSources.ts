import { array, object, text } from './gamewaire.ts';
import { readBotDepth } from './gamewireBotProjections.ts';
import { readBotRoster } from './gamewireBot.ts';
import { nflSimulationRuns, nflSimulationVersion, simulateNFLGame, simulateNFLTeamScore, simulationBox, simulationObservations, simulationPlayerLogs, simulationPlayerSeasons, simulationSchedule } from './nflSimulation.ts';
import { validateOvertimeEvidence } from './nflSimulationOvertime.ts';
import { neutralSimulationLearning, simulationLearningBaselines } from './nflSimulationLearning.ts';
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
  warnings: string[]; preparationIssues?: string[]; logs: Record<string, { season: number; refs: SimulationReference[]; done: boolean }>;
};
const boxKey = (id: string) => `nfl:simulation:box:v3:${id}`;
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
  const warnings: string[] = [], preparationIssues: string[] = [], injuries: NFLGameSimulation['injuries'] = [];
  const history = async (teamId: string) => {
    let refs: SimulationReference[] = [];
    for (let year = game.season; year >= game.season - 8 && refs.length < 100; year--) {
      const phases = await Promise.all(([2, 3] as const).map(phase => resource(
        `nfl:simulation:schedule:v2:${teamId}:${year}:${phase}`, cache, year === game.season ? 5 * 60000 : 365 * day,
        () => get(`${site}/teams/${teamId}/schedule?season=${year}&seasontype=${phase}&limit=1000`)
          .then(raw => simulationSchedule(raw, teamId, year, phase, cutoff))).catch(cause => {
            console.error('Simulation team schedule unavailable', teamId, year, phase, cause);
            const issue = `${teamId} (${year}, phase ${phase}): ${message(cause)}`;
            warnings.push(issue); preparationIssues.push(issue);
            return [];
          })));
      refs = unique([...refs, ...phases.flat()]).filter(ref => Date.parse(ref.date) < cutoff);
    }
    if (refs.length < 100) warnings.push(`${teamId}: ${refs.length}/100 verified completed team games available; a smaller sample is labeled, not presented as 100 games.`);
    return refs.slice(0, 100);
  };
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
  const availableRoster = (team: SimulationGame['home']) => roster(team).catch(cause => {
    console.error('Simulation current roster unavailable', team.id, cause);
    const issue = `${team.abbr}: current roster and availability unavailable (${message(cause)}); no player projections or starter assumptions are substituted.`;
    warnings.push(issue); preparationIssues.push(issue);
    return [];
  });
  const [home, away, homePlayers, awayPlayers] = await Promise.all([history(game.home.id), history(game.away.id), availableRoster(game.home), availableRoster(game.away)]);
  return { version: nflSimulationVersion, createdAt: new Date(now).toISOString(), history: { home, away },
    rosterPlayers: [...homePlayers, ...awayPlayers], players: null, injuries, warnings, preparationIssues, logs: {} };
}
function selectPlayers(job: SimulationJob, boxes: Map<string, SimulationBox>, quarterbacks: Record<string, string> = {}): SimulationPlayer[] {
  return [job.history.home, job.history.away].flatMap(refs => {
    const teamId = refs[0]?.teamId;
    if (!teamId) return [];
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
      const target = position === 'QB' ? candidates.find(player => player.id === quarterbacks[teamId]) : undefined;
      const selected = (target ? [target, ...candidates.filter(player => player.id !== target.id)] : candidates).slice(0, limit);
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
export async function advanceSimulation(game: SimulationGame, job: SimulationJob, cache: SimulationCache, get: (url: string) => Promise<unknown>, now: number,
  learning?: import('./nflSimulationLearning.ts').SimulationLearning['adjustments'],
  quarterbacks?: { home: string | null; away: string | null }): Promise<NFLGameSimulation> {
  const result: NFLGameSimulation & { preparationIssues: string[] } = { status: 'collecting', version: nflSimulationVersion, eventId: game.id, kickoff: game.date, checkedAt: job.createdAt,
    forecastAt: null, stage: 'Team history', progress: { completed: 0, total: 200 }, history: { home: 0, away: 0, target: 100 },
    runs: nflSimulationRuns, calibrated: false, preparationIssues: [...job.preparationIssues ?? []], warnings: [...job.warnings], injuries: job.injuries, scenarios: [] };
  const teamRefs = [...job.history.home, ...job.history.away], teamBatch = await boxBatch(teamRefs, cache, get, now);
  if (game.season < (game.seasonType === 2 ? 2025 : 2022)) {
    result.status = 'unavailable'; result.stage = 'Unsupported historical overtime rules';
    result.warnings.push('This overtime model supports regular seasons since 2025 and postseason since 2022 only.');
    return result;
  }
  result.progress = { completed: teamBatch.completed, total: teamBatch.total };
  result.history.home = job.history.home.filter(ref => teamBatch.boxes.has(ref.id)).length;
  result.history.away = job.history.away.filter(ref => teamBatch.boxes.has(ref.id)).length;
  result.warnings.push(...teamBatch.issues);
  result.preparationIssues.push(...teamBatch.issues);
  const regulationBoxes = new Map([...teamBatch.boxes].filter(([, box]) => box.regulationOnly === true));
  const overtime = {
    home: [...regulationBoxes.values()].flatMap(box => box.overtimeDrives ?? []).filter(drive => drive.teamId === game.home.id),
    away: [...regulationBoxes.values()].flatMap(box => box.overtimeDrives ?? []).filter(drive => drive.teamId === game.away.id),
  };
  try { validateOvertimeEvidence(overtime); }
  catch (cause) {
    result.warnings.push(message(cause), 'No default overtime scoring odds are substituted. Historical overtime or unverified period totals are excluded from regulation training.');
    result.stage = 'Preparing verified regulation and possession evidence';
    if (teamBatch.completed === teamBatch.total) result.status = 'unavailable';
    return result;
  }
  const excluded = teamBatch.boxes.size - regulationBoxes.size;
  if (excluded) result.warnings.push(`${excluded} historical games excluded from regulation cohorts: overtime or unverified quarter totals.`);
  result.warnings.push('Overtime bootstraps observed completed regulation possessions and durations, not fitted overtime strategy. Field position, clock-dependent play calling, kickoff returns and conversion decisions are not separately modeled. Scoring beyond the remaining regular-season clock is not credited; playoff possessions continue across 15-minute periods. Added points are score-only; genuine regular-season ties and equal rounded average scores remain possible.');
  const scoreRefs = (refs: SimulationReference[]) => refs.flatMap(ref => {
    if (!regulationBoxes.has(ref.id)) return [];
    const box = teamBatch.boxes.get(ref.id), own = box?.teams.find(team => team.id === ref.teamId), opponent = box?.teams.find(team => team.id === ref.opponentId);
    return own && opponent ? [{ ...ref, regulationOnly: true, scores: { own: own.points, opponent: opponent.points, home: own.home } }] : [];
  });
  const scoringHistory = { home: scoreRefs(job.history.home), away: scoreRefs(job.history.away) };
  const teamOnly = (refreshing: boolean) => {
    if (scoringHistory.home.length < 8 || scoringHistory.away.length < 8) {
      result.stage = 'Preparing verified team history';
      result.warnings.push('A numerical forecast requires at least eight verified prior final scores per team. Background preparation will retry; missing results are not invented.');
      return result;
    }
    result.status = 'ready';
    result.evidenceMode = 'team-only';
    result.refreshing = refreshing;
    result.forecastAt = new Date(now).toISOString();
    result.history = { home: scoringHistory.home.length, away: scoringHistory.away.length, target: 100 };
    result.scenarios = [simulateNFLTeamScore(game, scoringHistory, result.runs, overtime)];
    result.warnings.push('Team-only scoring estimate: verified prior final scores blend each team’s scoring with its opponent’s points allowed, using recency and home/away weighting. No player, quarterback, injury, touchdown or box-score estimates are invented.',
      'Experimental statistical estimate; win frequencies and score ranges are uncalibrated, not betting recommendations.');
    return result;
  };
  if (result.history.home < 8 || result.history.away < 8) return teamOnly(true);
  if (quarterbacks) job.players = selectPlayers(job, teamBatch.boxes,
    { [game.home.id]: quarterbacks.home ?? '', [game.away.id]: quarterbacks.away ?? '' });
  else job.players ??= selectPlayers(job, teamBatch.boxes);
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
      const issue = `${player.name} (${state.season}): ${message(cause)}`;
      result.warnings.push(issue); result.preparationIssues.push(issue); return;
    }
    state.refs = unique([...state.refs, ...evidence.refs]).filter(ref => Date.parse(ref.date) < Math.min(now, Date.parse(game.date))).slice(0, 100);
    const earlier = evidence.seasons.filter(year => year < state.season).sort((a, b) => b - a);
    if (state.refs.length >= 100 || state.season <= 2000 || evidence.seasons.length > 0 && !earlier.length) state.done = true;
    else state.season = earlier[0] ?? state.season - 1;
  }));
  result.progress = { completed: active.filter(player => job.logs[player.id]?.done).length, total: active.length };
  const refs = active.flatMap(player => job.logs[player.id]?.refs ?? []), playerBatch = await boxBatch(refs, cache, get, now);
  const boxes = new Map([...teamBatch.boxes, ...playerBatch.boxes].filter(([, box]) => box.regulationOnly === true));
  result.history.home = job.history.home.filter(ref => boxes.has(ref.id)).length;
  result.history.away = job.history.away.filter(ref => boxes.has(ref.id)).length;
  result.stage = 'Player production and defensive matchups';
  const required = unique([...teamRefs, ...refs]);
  result.progress = { completed: required.filter(ref => boxes.has(ref.id)).length, total: required.length };
  result.warnings.push(...playerBatch.issues);
  result.preparationIssues.push(...playerBatch.issues);
  const fetched = new Map([...teamBatch.boxes, ...playerBatch.boxes]);
  const refreshing = required.some(ref => !fetched.has(ref.id)) || active.some(player => !job.logs[player.id]?.done);
  const observations = new Map(active.map(player => [player.id, simulationObservations(player, job.logs[player.id]?.refs ?? [], boxes, now, issue => {
    console.error('Simulation player observation excluded', issue);
    result.warnings.push(issue);
  })]));
  const history = {
    home: job.history.home.flatMap(ref => boxes.has(ref.id) ? [boxes.get(ref.id)!] : []),
    away: job.history.away.flatMap(ref => boxes.has(ref.id) ? [boxes.get(ref.id)!] : []),
  };
  if (history.home.length < 8 || history.away.length < 8) return teamOnly(refreshing);
  result.scenarios = simulateNFLGame(game, history, job.players, observations, result.runs, undefined, overtime);
  if (quarterbacks && !result.scenarios.some(scenario => scenario.id === `${quarterbacks.home}:${quarterbacks.away}` && scenario.home && scenario.away)) {
    result.warnings.push('The selected QB matchup lacks verified player history; the forecast is team-only, with no substitute quarterback or player statistics.');
    return teamOnly(refreshing);
  }
  if (learning) {
    result.learning = { version: 'simulation-walk-forward-v1', adjustments: neutralSimulationLearning(now), baselines: simulationLearningBaselines(result.scenarios) };
  }
  result.warnings.push(...result.scenarios.flatMap(scenario => scenario.issue ? [scenario.issue] : []));
  result.scenarios = result.scenarios.filter(scenario => scenario.home && scenario.away);
  if (!result.scenarios.length) {
    result.stage = refreshing ? 'Preparing player evidence' : 'Team-only simulation complete';
    return teamOnly(refreshing);
  }
  result.status = 'ready';
  result.refreshing = refreshing;
  result.evidenceMode = refreshing || result.history.home < 100 || result.history.away < 100
    || result.scenarios.some(scenario => [...scenario.home!.players, ...scenario.away!.players].some(player => player.limited)) ? 'limited' : 'full';
  result.forecastAt = new Date(now).toISOString();
  result.stage = refreshing ? 'Refining player and team history' : 'Simulation complete';
  result.warnings.push(
    'Experimental joint empirical bootstrap; probabilities and 10th–90th percentile ranges are not calibrated or betting recommendations.',
    `Team history: ${result.history.home} home-team and ${result.history.away} away-team completed regular-season/playoff games, targeting 100 each; recency half-life 24 games and matching home/away weight 1.5×.`,
    'Player history: up to 100 verified production appearances across teams; recent and current-season production receives stronger weight, and same-opponent samples receive 1.5× weight.',
    'Defensive adjustments use observed passing/rushing yards per opportunity and points per yard, relative to historical opponent samples; coefficients are heuristic, not fitted injury effects.',
    'Every QB pairing is conditional, not a confirmed starter. Player markets require at least four verified category appearances; fewer than eight are labeled limited evidence. Listed questionable players are assumed to participate at observed usage.',
    'Reported out/inactive players are excluded from current allocations. Unmodeled players retain a team remainder; no specific injured-player replacement or numerical OL/defensive injury penalty is invented.',
    'Touchdowns use verified per-opportunity player production and opponent allowances. Passing/receiving touchdowns reconcile and scoring is bounded below by six points per offensive touchdown in every draw.',
    'Regulation uses joint yardage/scoring-rate outcomes from verified non-overtime games. Tied draws add empirical possession overtime under current NFL rules. Overtime is score-only: no player yards or touchdowns are invented; added points remain unallocated other points. Genuine regular-season ties and equal rounded average scores remain possible.',
  );
  if (result.learning) result.warnings.push('v5 learning is neutral: archived full-game player actuals include overtime, while these player expectations cover regulation only. Legacy v4 forecasts do not train this version.');
  return result;
}
