import { array, numeric, object, text } from './gamewaire.ts';

export const nflSimulationVersion = 'nfl-joint-bootstrap-v4';
export const previousNFLSimulationVersion = 'nfl-joint-bootstrap-v3';
export const legacyNFLSimulationVersion = 'nfl-joint-bootstrap-v1';
export const readableNFLSimulationVersions = [nflSimulationVersion, previousNFLSimulationVersion, 'nfl-joint-bootstrap-v2', legacyNFLSimulationVersion];
export const nflSimulationRuns = 1000;
export type SimulationPosition = 'QB' | 'RB' | 'WR' | 'TE';
export type SimulationStat = { passingAttempts: number; completions: number; passingYards: number; passingTouchdowns: number; rushingAttempts: number; rushingYards: number; rushingTouchdowns: number; receptions: number; receivingYards: number; receivingTouchdowns: number };
export type SimulationSide = SimulationStat & { id: string; home: boolean; points: number; players: Record<string, Partial<SimulationStat>> };
export type SimulationBox = { id: string; date: string; season: number; seasonType: 2 | 3; teams: SimulationSide[] };
export type SimulationGame = { id: string; date: string; season: number; seasonType: 2 | 3; home: { id: string; name: string; abbr: string }; away: { id: string; name: string; abbr: string } };
export type SimulationReference = { id: string; date: string; season: number; seasonType: 2 | 3; teamId: string; opponentId: string; scores?: { own: number; opponent: number; home: boolean } };
export type SimulationPlayer = { id: string; name: string; teamId: string; position: SimulationPosition; status: string; excluded: boolean; uncertain: boolean; role: string };
export type SimulationObservation = { eventId: string; date: string; teamId: string; opponentId: string; player: Partial<SimulationStat>; team: SimulationSide };
export type SimulationRange = { mean: number; p10: number; median: number; p90: number };
export type SimulationPlayerResult = { id: string; name: string; position: SimulationPosition; games: number; priorTeams: string[]; headToHeadGames: number; status: string; role: string; limited?: boolean; stats: Partial<Record<keyof SimulationStat, SimulationRange>>; issue: string | null };
type BaseTotal = 'passingYards' | 'rushingYards' | 'receptions' | 'otherReceivingYards' | 'otherReceptions' | 'otherRushingYards';
type TouchdownTotal = 'passingTouchdowns' | 'rushingTouchdowns' | 'otherReceivingTouchdowns' | 'otherRushingTouchdowns';
export type SimulationTeamTotals = Record<BaseTotal, SimulationRange> & Partial<Record<TouchdownTotal, SimulationRange>>;
export type SimulationTeamResult = { id: string; name: string; abbr: string; score: SimulationRange; winProbability: number; players: SimulationPlayerResult[]; teamOnly?: boolean; matchup?: { passingYardsMultiplier: number; rushingYardsMultiplier: number }; totals: SimulationTeamTotals | null };
export type SimulationScenario = { id: string; label: string; quarterbacks: { home: string; away: string }; issue: string | null; home: SimulationTeamResult | null; away: SimulationTeamResult | null; tieProbability: number | null };
export type SimulationLearningMetric = 'score' | 'passingYards' | 'rushingYards';
export type SimulationLearning = {
  version: 'simulation-walk-forward-v1';
  adjustments: Record<SimulationLearningMetric, import('./gamewireLearning.ts').LearningAdjustment>;
  baselines: Array<{ scenarioId: string; teams: Array<{ id: string; score: number; passingYards: number | null; rushingYards: number | null }> }>;
};
export type NFLGameSimulation = { status: 'collecting' | 'ready' | 'unavailable'; version: string; eventId: string; kickoff: string; checkedAt: string; forecastAt: string | null; stage: string; evidenceMode?: 'full' | 'limited' | 'team-only'; progress: { completed: number; total: number }; history: { home: number; away: number; target: 100 }; runs: number; calibrated: false; refreshing?: boolean; preparationIssues?: string[]; warnings: string[]; injuries: Array<{ name: string; position: string; teamId: string; status: string }>; scenarios: SimulationScenario[]; learning?: SimulationLearning };
export const simulationStatKeys: Array<keyof SimulationStat> = ['passingAttempts', 'completions', 'passingYards', 'passingTouchdowns', 'rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns'];

export function readNFLGameSimulation(value: unknown, eventId: string, kickoff: string, teams: { home: string; away: string }): NFLGameSimulation {
  const row = object(value), progress = object(row.progress), history = object(row.history);
  const flexible = [nflSimulationVersion, previousNFLSimulationVersion].includes(String(row.version));
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const integer = (n: unknown) => finite(n) && Number.isInteger(n) && n >= 0;
  const strings = (values: unknown) => Array.isArray(values) && values.every(n => typeof n === 'string');
  const learning = object(row.learning);
  const validLearning = row.learning === undefined || learning.version === 'simulation-walk-forward-v1'
    && ['score', 'passingYards', 'rushingYards'].every(metric => {
      const adjustment = object(object(learning.adjustments)[metric]);
      return adjustment.version === 'walk-forward-v1' && adjustment.mode === 'stat' && typeof adjustment.active === 'boolean'
        && finite(adjustment.adjustment) && adjustment.adjustment >= .9 && adjustment.adjustment <= 1.1
        && (adjustment.active || adjustment.adjustment === 1)
        && integer(adjustment.trainingGames) && integer(adjustment.validationGames)
        && ['baselineError', 'adjustedError'].every(key => adjustment[key] === null || finite(adjustment[key]) && Number(adjustment[key]) >= 0)
        && (adjustment.through === null || typeof adjustment.through === 'string' && finiteDate(adjustment.through)) && strings(adjustment.sampleIds);
    }) && Array.isArray(learning.baselines) && learning.baselines.every(raw => {
      const baseline = object(raw);
      return typeof baseline.scenarioId === 'string' && array(row.scenarios).some(raw => object(raw).id === baseline.scenarioId)
        && Array.isArray(baseline.teams) && baseline.teams.length === 2
        && baseline.teams.every(raw => {
          const team = object(raw);
          return [teams.home, teams.away].includes(String(team.id)) && finite(team.score) && team.score >= 0
            && ['passingYards', 'rushingYards'].every(key => team[key] === null || finite(team[key]) && Number(team[key]) >= 0);
        }) && new Set(baseline.teams.map(raw => object(raw).id)).size === 2;
    });
  const range = (value: unknown) => {
    const r = object(value);
    return ['mean', 'p10', 'median', 'p90'].every(key => finite(r[key]) && Number(r[key]) >= 0)
      && Number(r.p10) <= Number(r.median) && Number(r.median) <= Number(r.p90);
  };
  const probability = (n: unknown) => finite(n) && n >= 0 && n <= 1;
  const team = (value: unknown, id: string) => {
    const t = object(value), totals = object(t.totals);
    if (t.id !== id || typeof t.name !== 'string' || typeof t.abbr !== 'string' || !range(t.score) || !probability(t.winProbability)) return false;
    if (t.matchup !== undefined && !['passingYardsMultiplier', 'rushingYardsMultiplier'].every(key => {
      const factor = object(t.matchup)[key];
      return typeof factor === 'number' && Number.isFinite(factor) && factor >= Math.sqrt(.5) && factor <= Math.sqrt(1.5);
    })) return false;
    if (t.teamOnly === true) return flexible && row.evidenceMode === 'team-only' && t.totals === null && Array.isArray(t.players) && t.players.length === 0;
    return t.teamOnly !== true && (!flexible || row.evidenceMode !== 'team-only')
      && ['passingYards', 'rushingYards', 'receptions', 'otherReceivingYards', 'otherReceptions', 'otherRushingYards'].every(key => range(totals[key]))
      && (row.version === legacyNFLSimulationVersion || ['passingTouchdowns', 'rushingTouchdowns', 'otherReceivingTouchdowns', 'otherRushingTouchdowns'].every(key => range(totals[key])))
      && Array.isArray(t.players) && t.players.every(raw => {
        const p = object(raw), stats = object(p.stats);
        return typeof p.id === 'string' && /^\d{1,12}$/.test(p.id) && typeof p.name === 'string' && ['QB', 'RB', 'WR', 'TE'].includes(String(p.position))
          && integer(p.games) && Number(p.games) <= (row.version === nflSimulationVersion ? 100 : 30) && integer(p.headToHeadGames) && Number(p.headToHeadGames) <= Number(p.games)
          && strings(p.priorTeams) && (p.priorTeams as string[]).every(id => /^\d{1,12}$/.test(id))
          && typeof p.status === 'string' && typeof p.role === 'string' && (p.issue === null || typeof p.issue === 'string')
          && (flexible ? typeof p.limited === 'boolean' : p.limited === undefined || typeof p.limited === 'boolean')
          && (row.evidenceMode !== 'full' || p.limited !== true)
          && p.stats !== null && typeof p.stats === 'object' && !Array.isArray(p.stats)
          && Object.entries(stats).every(([key, stat]) => simulationStatKeys.includes(key as keyof SimulationStat) && range(stat))
          && (row.version === legacyNFLSimulationVersion || (!stats.passingYards || range(stats.passingTouchdowns))
            && (!stats.receivingYards || range(stats.receivingTouchdowns)) && (!stats.rushingYards || range(stats.rushingTouchdowns)));
      });
  };
  const scenarios = Array.isArray(row.scenarios) && row.scenarios.every(raw => {
    const s = object(raw), qbs = object(s.quarterbacks);
    return ['id', 'label'].every(key => typeof s[key] === 'string') && typeof qbs.home === 'string' && typeof qbs.away === 'string'
      && (typeof s.issue === 'string' && s.home === null && s.away === null && s.tieProbability === null
        || s.issue === null && team(s.home, teams.home) && team(s.away, teams.away) && probability(s.tieProbability)
          && Math.abs(Number(object(s.home).winProbability) + Number(object(s.away).winProbability) + Number(s.tieProbability) - 1) < 1e-8);
  });
  if (!validLearning || !readableNFLSimulationVersions.includes(String(row.version)) || row.eventId !== eventId || Date.parse(String(row.kickoff)) !== Date.parse(kickoff)
    || row.refreshing !== undefined && typeof row.refreshing !== 'boolean'
    || row.preparationIssues !== undefined && !strings(row.preparationIssues)
    || !['ready', 'collecting', 'unavailable'].includes(String(row.status)) || row.calibrated !== false || typeof row.stage !== 'string'
    || !Number.isFinite(Date.parse(String(row.checkedAt))) || !integer(progress.completed) || !integer(progress.total) || Number(progress.completed) > Number(progress.total)
    || !integer(history.home) || !integer(history.away) || Number(history.home) > 100 || Number(history.away) > 100 || history.target !== 100
    || !integer(row.runs) || Number(row.runs) < 500 || Number(row.runs) > 10000 || !strings(row.warnings)
    || !Array.isArray(row.injuries) || !row.injuries.every(raw => {
      const injury = object(raw);
      return ['name', 'position', 'teamId', 'status'].every(key => typeof injury[key] === 'string') && [teams.home, teams.away].includes(String(injury.teamId));
    }) || !scenarios || row.status === 'collecting' && (row.forecastAt !== null || (row.scenarios as unknown[]).length !== 0)
    || row.status !== 'collecting' && (!Number.isFinite(Date.parse(String(row.forecastAt))) || Date.parse(String(row.forecastAt)) >= Date.parse(kickoff)
      || (flexible ? Number(history.home) < 8 || Number(history.away) < 8
        || !['full', 'limited', 'team-only'].includes(String(row.evidenceMode))
        || row.evidenceMode === 'full' && (history.home !== 100 || history.away !== 100)
        : history.home !== 100 || history.away !== 100) || !(row.scenarios as unknown[]).length)
    || row.status === 'ready' && !(row.scenarios as unknown[]).some(raw => object(raw).issue === null))
    throw new Error('The NFL simulator returned an invalid or mismatched forecast. Retry; no substitute estimates are shown.');
  return value as NFLGameSimulation;
}

const validId = (value: string) => /^\d{1,12}$/.test(value);
const finiteDate = (value: string) => Number.isFinite(Date.parse(value));
const emptyStat = (): SimulationStat => ({ passingAttempts: 0, completions: 0, passingYards: 0, passingTouchdowns: 0, rushingAttempts: 0, rushingYards: 0, rushingTouchdowns: 0, receptions: 0, receivingYards: 0, receivingTouchdowns: 0 });
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
const round = (n: number) => Math.round(n * 10) / 10;
const count = (value: unknown, label: string): number => {
  const n = numeric(value);
  if (n === undefined || !Number.isInteger(n) || n < 0) throw new Error(`Invalid ${label} in the NFL simulation evidence.`);
  return n;
};
const yards = (value: unknown, label: string): number => {
  const n = numeric(value);
  if (n === undefined || !Number.isInteger(n)) throw new Error(`Missing ${label} in the NFL simulation evidence.`);
  return n;
};
export function simulationGame(value: unknown, eventId: string, now: number): SimulationGame {
  const header = object(object(value).header), competition = object(array(header.competitions)[0]), season = object(header.season);
  const type = numeric(season.type), date = text(competition.date);
  if (text(header.id) !== eventId || !validId(eventId) || !finiteDate(date) || Date.parse(date) <= now
    || text(object(object(competition.status).type).state) !== 'pre' || ![2, 3].includes(type ?? 0)
    || !Number.isInteger(season.year)) throw new Error('Simulations require a verified upcoming regular-season or playoff NFL game.');
  const sides = array(competition.competitors).map(object);
  const read = (side: string) => {
    const team = object(sides.find(row => row.homeAway === side)?.team);
    if (!validId(text(team.id)) || !text(team.displayName) || !text(team.abbreviation)) throw new Error('Simulation team identities are incomplete.');
    return { id: text(team.id), name: text(team.displayName), abbr: text(team.abbreviation) };
  };
  const home = read('home'), away = read('away');
  if (sides.length !== 2 || home.id === away.id) throw new Error('Simulation requires two different NFL teams.');
  return { id: eventId, date, season: Number(season.year), seasonType: type as 2 | 3, home, away };
}
export function simulationSchedule(value: unknown, teamId: string, season: number, phase: 2 | 3, cutoff: number): SimulationReference[] {
  const data = object(value), requested = object(data.requestedSeason ?? data.season);
  // ESPN omits requestedSeason for empty playoff schedules and leaves season at the current league year.
  if (text(object(data.team).id) === teamId && Array.isArray(data.events) && data.events.length === 0 && data.requestedSeason === undefined) return [];
  if (text(object(data.team).id) !== teamId || numeric(requested.year) !== season || !Array.isArray(data.events)
    || data.events.length && numeric(requested.type) !== phase) throw new Error('Simulation history returned a different team, season or phase.');
  return array(data.events).flatMap(raw => {
    const event = object(raw), competition = object(array(event.competitions)[0]), status = object(object(competition.status ?? event.status).type);
    if (status.completed !== true || status.state !== 'post' || /cancel|postpon|suspend|abandon/i.test(text(status.name))) return [];
    const date = text(event.date ?? competition.date), sides = array(competition.competitors).map(object);
    if (!finiteDate(date)) throw new Error('A completed historical game has no valid date.');
    if (Date.parse(date) >= cutoff) return [];
    if (event.season !== undefined && numeric(object(event.season).year) !== season
      || event.seasonType !== undefined && numeric(object(event.seasonType).type) !== phase)
      throw new Error('A historical game belongs to a different season or phase.');
    const own = sides.find(row => text(object(row.team).id) === teamId), other = sides.find(row => row !== own);
    if (sides.length !== 2 || !own || !other || !validId(text(event.id)) || !validId(text(object(other.team).id))) throw new Error('Historical matchup identity is incomplete.');
    const score = (side: Record<string, unknown>) => count(typeof side.score === 'object' ? object(side.score).value ?? object(side.score).displayValue : side.score, 'final score');
    if (!['home', 'away'].includes(text(own.homeAway)) || !['home', 'away'].includes(text(other.homeAway)) || text(other.homeAway) === text(own.homeAway)) throw new Error('Historical home/away identity is unavailable.');
    return [{ id: text(event.id), date, season, seasonType: phase, teamId, opponentId: text(object(other.team).id),
      scores: { own: score(own), opponent: score(other), home: own.homeAway === 'home' } }];
  });
}
export function simulationPlayerSeasons(value: unknown, season: number): number[] {
  const filters = array(object(value).filters).map(object), filter = filters.find(row => row.name === 'season');
  if (!filter) return [];
  if (text(filter.value) !== String(season)) throw new Error('Player history selected a different NFL season.');
  return array(filter.options).map(option => Number(text(object(option).value))).filter(year => Number.isInteger(year) && year >= 2000 && year <= 2200);
}
export function simulationPlayerLogs(value: unknown, season: number, cutoff: number, quarterback = false): SimulationReference[] {
  const data = object(value);
  const seasons = simulationPlayerSeasons(value, season);
  if (seasons.length && data.names === undefined && data.seasonTypes === undefined && data.events === undefined) return [];
  if (!Array.isArray(data.seasonTypes) || !data.events || !Array.isArray(data.names)) throw new Error('Cross-team player game logs are unavailable.');
  const refs = new Map<string, SimulationReference>();
  for (const raw of data.seasonTypes) {
    const type = object(raw), label = text(type.displayName);
    const phase = /regular season/i.test(label) ? 2 : /postseason|post season|playoff/i.test(label) ? 3 : numeric(type.type);
    if (phase !== 2 && phase !== 3) continue;
    if (!new RegExp(`\\b${season}\\b`).test(label)) throw new Error('Player history returned a different NFL season.');
    for (const category of array(type.categories)) for (const entry of array(object(category).events)) {
      const attemptsIndex = array(data.names).indexOf('passingAttempts');
      if (quarterback && attemptsIndex >= 0) {
        const attempts = numeric(array(object(entry).stats)[attemptsIndex]);
        if (attempts !== undefined && attempts < 10) continue;
      }
      const id = text(object(entry).eventId), event = object(object(data.events)[id]), date = text(event.gameDate);
      const opponentId = text(object(event.opponent).id), homeId = text(event.homeTeamId), awayId = text(event.awayTeamId);
      const teamId = validId(homeId) && validId(awayId) && [homeId, awayId].includes(opponentId)
        ? homeId === opponentId ? awayId : homeId : text(object(event.team).id);
      if (!finiteDate(date)) throw new Error('A player appearance has no verified date.');
      if (Date.parse(date) >= cutoff) continue;
      if (!validId(id) || !validId(teamId) || !validId(opponentId) || teamId === opponentId) throw new Error('Player history lacks cross-team appearance identities.');
      refs.set(id, { id, date, season, seasonType: phase, teamId, opponentId });
    }
  }
  return [...refs.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export function simulationBox(value: unknown, eventId: string, cutoff: number): SimulationBox {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]), season = object(header.season);
  const date = text(competition.date), phase = numeric(season.type), sides = array(competition.competitors).map(object);
  const status = object(object(competition.status).type);
  if (text(header.id) !== eventId || !validId(eventId) || status.completed !== true || status.state !== 'post'
    || /cancel|postpon|suspend|abandon/i.test(text(status.name)) || !finiteDate(date) || Date.parse(date) >= cutoff
    || !Number.isInteger(season.year) || ![2, 3].includes(phase ?? 0) || sides.length !== 2)
    throw new Error('A simulation box score did not confirm the requested completed regular-season/playoff game.');
  const teams = sides.map(side => {
    const id = text(object(side.team).id);
    if (!validId(id)) throw new Error('A simulation box score has no verified team identity.');
    const offense = array(object(data.boxscore).players).map(object).find(row => text(object(row.team).id) === id);
    if (!offense) throw new Error('A completed simulation game has no offensive box score.');
    const total = emptyStat(), players: SimulationSide['players'] = {};
    for (const category of ['passing', 'rushing', 'receiving']) {
      const stats = array(offense.statistics).map(object).find(row => row.name === category);
      if (!stats || !Array.isArray(stats.athletes) || !Array.isArray(stats.keys)) throw new Error(`Completed ${category} evidence is unavailable.`);
      const keys = array(stats.keys).map(text);
      for (const raw of stats.athletes) {
        const row = object(raw), athleteId = text(object(row.athlete).id);
        if (!validId(athleteId)) throw new Error('A box-score player has no verified identity.');
        const player = players[athleteId] ??= {};
        const stat = (key: string) => array(row.stats)[keys.indexOf(key)];
        const set = (key: keyof SimulationStat, value: number) => { player[key] = value; total[key] += value; };
        if (category === 'passing') {
          const combined = text(stat('completions/passingAttempts')).split('/');
          const completions = count(keys.includes('completions') ? stat('completions') : combined[0], 'completions');
          const attempts = count(keys.includes('passingAttempts') ? stat('passingAttempts') : combined[1], 'passing attempts');
          if (completions > attempts) throw new Error('Completions exceed passing attempts.');
          set('completions', completions); set('passingAttempts', attempts); set('passingYards', yards(stat('passingYards'), 'passing yards'));
          const touchdowns = count(stat('passingTouchdowns'), 'passing touchdowns');
          if (touchdowns > completions) throw new Error('Passing touchdowns exceed completions.');
          set('passingTouchdowns', touchdowns);
        } else if (category === 'rushing') {
          set('rushingAttempts', count(stat('rushingAttempts'), 'rushing attempts')); set('rushingYards', yards(stat('rushingYards'), 'rushing yards'));
          const touchdowns = count(stat('rushingTouchdowns'), 'rushing touchdowns');
          if (touchdowns > player.rushingAttempts!) throw new Error('Rushing touchdowns exceed attempts.');
          set('rushingTouchdowns', touchdowns);
        } else {
          set('receptions', count(stat('receptions'), 'receptions')); set('receivingYards', yards(stat('receivingYards'), 'receiving yards'));
          const touchdowns = count(stat('receivingTouchdowns'), 'receiving touchdowns');
          // A lateral can credit yards and a TD to a player without crediting them a reception.
          set('receivingTouchdowns', touchdowns);
        }
      }
    }
    if (total.completions !== total.receptions || total.passingYards !== total.receivingYards || total.passingTouchdowns !== total.receivingTouchdowns)
      throw new Error('Passing and receiving box-score totals do not reconcile.');
    return { ...total, id, home: side.homeAway === 'home', points: count(side.score, 'final score'), players };
  });
  if (teams[0].id === teams[1].id) throw new Error('A completed simulation game has duplicate teams.');
  return { id: eventId, date, season: Number(season.year), seasonType: phase as 2 | 3, teams };
}
export function simulationObservations(player: SimulationPlayer, refs: SimulationReference[], boxes: Map<string, SimulationBox>, cutoff: number, onIssue?: (issue: string) => void): SimulationObservation[] {
  const seen = new Set<string>();
  return refs.flatMap(ref => {
    if (seen.has(ref.id) || Date.parse(ref.date) >= cutoff) return [];
    seen.add(ref.id);
    const reject = (reason: string): SimulationObservation[] => {
      const issue = `${player.name || player.id} (${ref.id}): ${reason}`;
      if (!onIssue) throw new Error(issue);
      onIssue(issue);
      return [];
    };
    const box = boxes.get(ref.id);
    if (!box || box.season !== ref.season || box.seasonType !== ref.seasonType || Date.parse(box.date) !== Date.parse(ref.date)
      || !box.teams.some(side => side.id === ref.opponentId)) return reject('A player appearance could not be matched to its completed box score.');
    const team = box.teams.find(side => side.id === ref.teamId), observed = team?.players[player.id];
    if (!team || !observed) return reject('The completed offensive box score does not verify this player on their historical team; no missing production is assumed to be zero.');
    if (player.position === 'QB' && (observed.passingAttempts ?? 0) < 10) return [];
    if (player.position !== 'QB' && !(observed.rushingAttempts || observed.receptions || observed.rushingYards || observed.receivingYards || observed.rushingTouchdowns || observed.receivingTouchdowns)) return [];
    return [{ eventId: box.id, date: box.date, teamId: team.id, opponentId: ref.opponentId, player: observed, team }];
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 100);
}
export function simulationRange(values: number[]): SimulationRange {
  if (!values.length || values.some(n => !Number.isFinite(n))) throw new Error('Simulation output has no finite observations.');
  const ordered = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const index = (ordered.length - 1) * p, low = Math.floor(index);
    return round(ordered[low] + (ordered[Math.ceil(index)] - ordered[low]) * (index - low));
  };
  return { mean: round(mean(values)), p10: q(.1), median: q(.5), p90: q(.9) };
}
function weights<T>(rows: T[], halfLife: number, similarity: (row: T) => number = () => 1) {
  return rows.map((row, index) => 2 ** (-index / halfLife) * similarity(row));
}
export function simulationPlayerWeights(rows: SimulationObservation[], season: number, opponentId: string): number[] {
  return rows.map((row, index) => {
    const date = new Date(row.date), year = date.getUTCFullYear();
    const nflSeason = date.getUTCMonth() < 2 ? year - 1 : year;
    return (.65 * 2 ** (-index / 5) + .35 * 2 ** (-index / 24))
      * (nflSeason === season ? 2 : 1) * (row.opponentId === opponentId ? 1.5 : 1);
  });
}
function weighted<T>(rows: T[], weight: number[], value: (row: T) => number) {
  return rows.reduce((sum, row, i) => sum + weight[i] * value(row), 0) / weight.reduce((a, b) => a + b, 0);
}
const cumulativeWeights = new WeakMap<number[], number[]>();
function draw<T>(rows: T[], weight: number[], random: () => number): T {
  let cumulative = cumulativeWeights.get(weight);
  if (!cumulative) {
    let sum = 0;
    cumulative = weight.map(n => sum += n);
    cumulativeWeights.set(weight, cumulative);
  }
  const point = random() * cumulative[cumulative.length - 1];
  let low = 0, high = cumulative.length - 1;
  while (low < high) { const middle = (low + high) >>> 1; if (point < cumulative[middle]) high = middle; else low = middle + 1; }
  return rows[low];
}
function generator(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
function allocate(total: number, shares: number[]): number[] {
  const safe = shares.map(n => Math.max(0, n)), sum = safe.reduce((a, b) => a + b, 0);
  if (!sum) throw new Error('Simulation opportunity allocation has no supported shares.');
  const raw = safe.map(n => total * n / sum), result = raw.map(Math.floor);
  const order = raw.map((n, i) => ({ i, rest: n - result[i] })).sort((a, b) => b.rest - a.rest);
  const remaining = total - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) result[order[i].i]++;
  return result;
}
function allocateCapped(total: number, shares: number[], caps: number[]): number[] {
  const result = shares.map(() => 0);
  let remaining = total;
  while (remaining > 0) {
    const indices = shares.map((_n, i) => i).filter(i => shares[i] > 0 && result[i] < caps[i]);
    if (!indices.length) break;
    const proposal = allocate(remaining, indices.map(i => shares[i]));
    let added = 0;
    indices.forEach((i, j) => { const amount = Math.min(proposal[j], caps[i] - result[i]); result[i] += amount; added += amount; });
    if (!added) break;
    remaining -= added;
  }
  return result;
}
export function roundedSimulationBox(team: SimulationTeamResult & { totals: SimulationTeamTotals }) {
  if (team.totals === null) throw new Error('Team-only scoring does not support a projected box score.');
  const teamTotals = team.totals;
  const players = Object.fromEntries(team.players.map(player => [player.id, Object.fromEntries(Object.entries(player.stats).map(([key, value]) => [key, Math.round(value!.mean)])) as Partial<SimulationStat>]));
  const remainder: Partial<Record<BaseTotal | TouchdownTotal, number>> = {};
  const reconcile = (key: keyof SimulationStat, total: number, otherKey: BaseTotal | TouchdownTotal, caps?: number[], listedOnly = false) => {
    const supported = team.players.filter(player => player.stats[key]);
    let listedShares = supported.map(player => player.stats[key]!.mean);
    if (listedOnly && key === 'receivingYards' && !listedShares.some((share, i) => share > 0 && (!caps || caps[i] > 0))) {
      listedShares = supported.map(player => players[player.id].receptions ?? 0);
    }
    const allocateToListed = listedOnly && listedShares.some((share, i) => share > 0 && (!caps || caps[i] > 0));
    const shares = [...listedShares, allocateToListed ? 0 : teamTotals[otherKey]?.mean ?? 0];
    const values = total === 0 ? shares.map(() => 0) : caps ? allocateCapped(total, shares, caps) : allocate(total, shares);
    supported.forEach((player, i) => { players[player.id][key] = values[i]; });
    remainder[otherKey] = values[values.length - 1];
    return { total: values.reduce((a, b) => a + b, 0), other: values[values.length - 1] };
  };
  const quarterback = team.players.find(player => player.stats.passingYards);
  const score = Math.round(team.score.mean);
  let passingYards: number | null = null, completions: number | null = null;
  let passingTouchdowns: number | null = null, rushingTouchdowns: number | null = null, otherReceivingTouchdowns: number | null = null;
  if (quarterback) {
    completions = reconcile('receptions', Math.round(team.totals.receptions.mean), 'otherReceptions', undefined, true).total;
    players[quarterback.id].completions = completions;
    const receivers = team.players.filter(player => player.stats.receivingYards);
    passingYards = reconcile('receivingYards', Math.round(team.totals.passingYards.mean), 'otherReceivingYards',
      [...receivers.map(player => players[player.id].receptions ? Number.MAX_SAFE_INTEGER : 0), remainder.otherReceptions ? Number.MAX_SAFE_INTEGER : 0], true).total;
    players[quarterback.id].passingYards = passingYards;
  }
  const rushersWithYards = team.players.filter(player => player.stats.rushingYards);
  const rushingYards = reconcile('rushingYards', Math.round(team.totals.rushingYards.mean), 'otherRushingYards',
    [...rushersWithYards.map(player => players[player.id].rushingAttempts ? Number.MAX_SAFE_INTEGER : 0), Number.MAX_SAFE_INTEGER]).total;
  if (team.totals.passingTouchdowns && team.totals.rushingTouchdowns && quarterback) {
    const shares = [team.totals.passingTouchdowns.mean, team.totals.rushingTouchdowns.mean];
    const total = Math.min(Math.round(shares[0] + shares[1]), Math.floor(score / 6));
    const [passing, rushing] = total ? allocate(total, shares) : [0, 0];
    const receivers = team.players.filter(player => player.stats.receivingTouchdowns);
    const receivingTDs = reconcile('receivingTouchdowns', passing, 'otherReceivingTouchdowns',
      [...receivers.map(player => players[player.id].receptions ?? 0), remainder.otherReceptions ?? 0]);
    passingTouchdowns = receivingTDs.total;
    otherReceivingTouchdowns = receivingTDs.other;
    players[quarterback.id].passingTouchdowns = passingTouchdowns;
    const rushers = team.players.filter(player => player.stats.rushingTouchdowns);
    rushingTouchdowns = reconcile('rushingTouchdowns', rushing, 'otherRushingTouchdowns',
      [...rushers.map(player => players[player.id].rushingAttempts ?? 0), Number.MAX_SAFE_INTEGER]).total;
  }
  const sum = (key: keyof SimulationStat) => team.players.reduce((total, player) => total + (players[player.id][key] ?? 0), 0);
  const listed = {
    receivingYards: sum('receivingYards'), receptions: sum('receptions'), rushingYards: sum('rushingYards'),
    receivingTouchdowns: passingTouchdowns !== null ? sum('receivingTouchdowns') : null,
    rushingTouchdowns: rushingTouchdowns !== null ? sum('rushingTouchdowns') : null,
  };
  const totals = {
    passingYards, receivingYards: passingYards, completions, receptions: completions, rushingYards, passingTouchdowns, rushingTouchdowns,
    receivingTouchdowns: otherReceivingTouchdowns !== null ? sum('receivingTouchdowns') + otherReceivingTouchdowns : null,
  };
  const offensivePoints = totals.passingTouchdowns !== null && totals.rushingTouchdowns !== null
    ? 6 * (totals.passingTouchdowns + totals.rushingTouchdowns) : null;
  const scoring = offensivePoints !== null ? { offensivePoints, otherPoints: score - offensivePoints } : null;
  return { score, players, remainder, listed, totals, scoring };
}
type TeamDraw = { points: number; stats: Record<string, Partial<SimulationStat>> } & Record<BaseTotal | TouchdownTotal, number>;
type HistoricalPair = { own: SimulationSide; opponent: SimulationSide; date: string };
export function simulateNFLTeamScore(game: SimulationGame, history: { home: SimulationReference[]; away: SimulationReference[] }, runs = nflSimulationRuns): SimulationScenario {
  if (!Number.isInteger(runs) || runs < 500 || runs > 10000) throw new Error('Simulation runs must be between 500 and 10000.');
  const read = (refs: SimulationReference[], teamId: string) => {
    const seen = new Set<string>();
    const rows = [...refs].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    if (rows.length < 8 || rows.length > 100) throw new Error('Team-only scoring requires 8–100 verified completed games per team.');
    return rows.map(ref => {
      if (ref.teamId !== teamId || !validId(ref.id) || seen.has(ref.id) || !validId(ref.opponentId) || ref.opponentId === teamId
        || !finiteDate(ref.date) || Date.parse(ref.date) >= Date.parse(game.date) || !Number.isInteger(ref.season) || ref.season < 2000 || ref.season > game.season || ![2, 3].includes(ref.seasonType)
        || !ref.scores || !Number.isInteger(ref.scores.own) || ref.scores.own < 0 || !Number.isInteger(ref.scores.opponent) || ref.scores.opponent < 0
        || typeof ref.scores.home !== 'boolean') throw new Error('Team-only scoring requires verified prior final scores and matchup identities.');
      seen.add(ref.id); return ref.scores;
    });
  };
  const home = read(history.home, game.home.id), away = read(history.away, game.away.id);
  const homeWeight = weights(home, 24, row => row.home ? 1.5 : 1), awayWeight = weights(away, 24, row => !row.home ? 1.5 : 1);
  const random = generator(`${nflSimulationVersion}:${game.id}:team-only`);
  const homeScores: number[] = [], awayScores: number[] = [];
  let homeWins = 0, awayWins = 0, ties = 0;
  for (let i = 0; i < runs; i++) {
    const h = draw(home, homeWeight, random), a = draw(away, awayWeight, random);
    const homeScore = Math.round((h.own + a.opponent) / 2), awayScore = Math.round((a.own + h.opponent) / 2);
    homeScores.push(homeScore); awayScores.push(awayScore);
    if (homeScore > awayScore) homeWins++; else if (awayScore > homeScore) awayWins++; else ties++;
  }
  return { id: 'team-only', label: 'Team-only scoring estimate', quarterbacks: { home: 'Unconfirmed', away: 'Unconfirmed' }, issue: null,
    home: { ...game.home, score: simulationRange(homeScores), winProbability: homeWins / runs, players: [], teamOnly: true, totals: null },
    away: { ...game.away, score: simulationRange(awayScores), winProbability: awayWins / runs, players: [], teamOnly: true, totals: null }, tieProbability: ties / runs };
}
export function simulateNFLGame(game: SimulationGame, history: { home: SimulationBox[]; away: SimulationBox[] },
  players: SimulationPlayer[], observations: Map<string, SimulationObservation[]>, runs = nflSimulationRuns,
  learned = { score: 1, passingYards: 1, rushingYards: 1 }): SimulationScenario[] {
  if (!Number.isInteger(runs) || runs < 500 || runs > 10000) throw new Error('Simulation runs must be between 500 and 10000.');
  if (Object.values(learned).some(value => !Number.isFinite(value) || value < .9 || value > 1.1))
    throw new Error('Simulation learning corrections must remain within ten percent.');
  const pair = (boxes: SimulationBox[], teamId: string): HistoricalPair[] => {
    const seen = new Set<string>();
    const rows = [...boxes].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).map(box => {
      const own = box.teams.find(side => side.id === teamId), opponent = box.teams.find(side => side.id !== teamId);
      if (!own || !opponent || seen.has(box.id) || Date.parse(box.date) >= Date.parse(game.date) || ![2, 3].includes(box.seasonType))
        throw new Error('Simulation requires unique, pre-kickoff completed team histories.');
      if ([own, opponent].some(side => !Number.isInteger(side.passingTouchdowns) || !Number.isInteger(side.rushingTouchdowns)
        || side.passingTouchdowns < 0 || side.rushingTouchdowns < 0)) throw new Error('Team history is missing verified touchdown production.');
      seen.add(box.id);
      return { own, opponent, date: box.date };
    });
    if (rows.length < 8 || rows.length > 100) throw new Error('Between 8 and 100 completed regular-season/playoff games per team are required.');
    return rows;
  };
  const homeRows = pair(history.home, game.home.id), awayRows = pair(history.away, game.away.id);
  const homeWeight = weights(homeRows, 24, row => row.own.home ? 1.5 : 1), awayWeight = weights(awayRows, 24, row => !row.own.home ? 1.5 : 1);
  const reference = [...homeRows, ...awayRows], referenceWeight = weights(homeRows, 24).concat(weights(awayRows, 24));
  const referencePass = weighted(reference, referenceWeight, row => row.opponent.passingYards) / Math.max(1, weighted(reference, referenceWeight, row => row.opponent.passingAttempts));
  const referenceRush = weighted(reference, referenceWeight, row => row.opponent.rushingYards) / Math.max(1, weighted(reference, referenceWeight, row => row.opponent.rushingAttempts));
  const referenceScoring = weighted(reference, referenceWeight, row => row.opponent.points) / Math.max(1, weighted(reference, referenceWeight, row => row.opponent.passingYards + row.opponent.rushingYards));
  const referencePassTD = weighted(reference, referenceWeight, row => row.opponent.passingTouchdowns) / Math.max(1, weighted(reference, referenceWeight, row => row.opponent.passingAttempts));
  const referenceRushTD = weighted(reference, referenceWeight, row => row.opponent.rushingTouchdowns) / Math.max(1, weighted(reference, referenceWeight, row => row.opponent.rushingAttempts));
  const candidates = (id: string) => players.filter(p => p.teamId === id && p.position === 'QB' && !p.excluded);
  const homeQBs = candidates(game.home.id), awayQBs = candidates(game.away.id);
  if (!homeQBs.length || !awayQBs.length) return [{ id: 'unavailable', label: 'Quarterback scenarios unavailable', quarterbacks: { home: '', away: '' },
    issue: 'No eligible current-roster quarterback candidate was verified for both teams.', home: null, away: null, tieProbability: null }];
  const results: SimulationScenario[] = [];
  for (const homeQB of homeQBs) for (const awayQB of awayQBs) {
    const id = `${homeQB.id}:${awayQB.id}`, label = `${game.away.abbr}: ${awayQB.name} / ${game.home.abbr}: ${homeQB.name}`;
    const quarterbacks = { home: homeQB.name, away: awayQB.name };
    const qbIssue = [homeQB, awayQB].filter(p => (observations.get(p.id)?.filter(row => (row.player.passingAttempts ?? 0) >= 10 && ['passingAttempts', 'completions', 'passingYards', 'passingTouchdowns'].every(key => row.player[key as keyof SimulationStat] !== undefined)).length ?? 0) < 4);
    if (qbIssue.length) {
      results.push({ id, label, quarterbacks, issue: `${qbIssue.map(p => p.name).join(', ')}: fewer than four verified appearances with at least 10 passing attempts. No replacement QB statistics are invented.`,
        home: null, away: null, tieProbability: null }); continue;
    }
    const random = generator(`${nflSimulationVersion}:${game.id}:${id}`);
    const setup = (teamId: string, qb: SimulationPlayer, defenseRows: HistoricalPair[], defenseWeights: number[]) => {
      const active = players.filter(p => p.teamId === teamId && !p.excluded && (p.position !== 'QB' || p.id === qb.id));
      const usable = active.filter(p => (observations.get(p.id)?.length ?? 0) >= 4);
      const opponentId = teamId === game.home.id ? game.away.id : game.home.id;
      const cohorts = new Map<string, { rows: SimulationObservation[]; weights: number[] }>();
      for (const p of usable) for (const [market, keys] of [
        ['passing', ['passingAttempts', 'passingYards', 'completions', 'passingTouchdowns']],
        ['receiving', ['receptions', 'receivingYards', 'receivingTouchdowns']],
        ['rushing', ['rushingAttempts', 'rushingYards', 'rushingTouchdowns']],
      ] as const) {
        if (market === 'passing' && p.position !== 'QB' || market === 'receiving' && p.position === 'QB'
          || market === 'rushing' && !['QB', 'RB'].includes(p.position)) continue;
        const rows = observations.get(p.id)!.filter(row => keys.every(key => row.player[key] !== undefined));
        if (rows.length >= 4) cohorts.set(`${p.id}:${market}`, { rows, weights: simulationPlayerWeights(rows, game.season, opponentId) });
      }
      const allowedPass = weighted(defenseRows, defenseWeights, row => row.opponent.passingYards) / Math.max(1, weighted(defenseRows, defenseWeights, row => row.opponent.passingAttempts));
      const allowedRush = weighted(defenseRows, defenseWeights, row => row.opponent.rushingYards) / Math.max(1, weighted(defenseRows, defenseWeights, row => row.opponent.rushingAttempts));
      const allowedScoring = weighted(defenseRows, defenseWeights, row => row.opponent.points) / Math.max(1, weighted(defenseRows, defenseWeights, row => row.opponent.passingYards + row.opponent.rushingYards));
      const allowedPassTD = weighted(defenseRows, defenseWeights, row => row.opponent.passingTouchdowns) / Math.max(1, weighted(defenseRows, defenseWeights, row => row.opponent.passingAttempts));
      const allowedRushTD = weighted(defenseRows, defenseWeights, row => row.opponent.rushingTouchdowns) / Math.max(1, weighted(defenseRows, defenseWeights, row => row.opponent.rushingAttempts));
      const ratio = (a: number, b: number) => Math.sqrt(Math.max(.5, Math.min(1.5, a / Math.max(.01, b))));
      return { active, usable, cohorts, passAdjustment: ratio(allowedPass, referencePass), rushAdjustment: ratio(allowedRush, referenceRush),
        scoringAdjustment: ratio(allowedScoring, referenceScoring), passTDAdjustment: ratio(allowedPassTD, referencePassTD), rushTDAdjustment: ratio(allowedRushTD, referenceRushTD) };
    };
    const homeSetup = setup(game.home.id, homeQB, awayRows, awayWeight), awaySetup = setup(game.away.id, awayQB, homeRows, homeWeight);
    const teamDraw = (own: SimulationSide, allowed: SimulationSide, qb: SimulationPlayer, context: ReturnType<typeof setup>): TeamDraw => {
      const sample = (p: SimulationPlayer, market: string) => {
        const cohort = context.cohorts.get(`${p.id}:${market}`);
        if (!cohort) throw new Error('A simulation market has no verified historical cohort.');
        return draw(cohort.rows, cohort.weights, random);
      };
      const qbSample = sample(qb, 'passing'), qbStats = qbSample.player;
      const passAttempts = Math.max(0, Math.round((own.passingAttempts + allowed.passingAttempts) / 2));
      const completions = Math.min(passAttempts, Math.max(0, Math.round(passAttempts * (qbStats.completions ?? 0) / qbStats.passingAttempts!)));
      const receivers = context.usable.filter(p => p.position !== 'QB' && context.cohorts.has(`${p.id}:receiving`));
      const receivingSamples = receivers.map(p => sample(p, 'receiving'));
      const catchShares = receivingSamples.map(row => row.player.receptions! / Math.max(1, row.team.receptions));
      const catches = allocate(completions, [...catchShares, Math.max(.1, 1 - catchShares.reduce((a, b) => a + b, 0))]);
      const qbYPC = Math.max(0, qbStats.passingYards! / Math.max(1, qbStats.completions!));
      const baseReceiverYards = receivers.map((_p, i) => {
        const observed = receivingSamples[i].player;
        return Math.max(0, Math.round(catches[i] * observed.receivingYards! / Math.max(1, observed.receptions!) * context.passAdjustment));
      });
      const receiverYards = baseReceiverYards.map(yards => Math.round(yards * learned.passingYards));
      const otherReceptions = catches[catches.length - 1], baseOtherReceivingYards = Math.max(0, Math.round(otherReceptions * qbYPC * context.passAdjustment));
      const otherReceivingYards = Math.round(baseOtherReceivingYards * learned.passingYards);
      const passingYards = receiverYards.reduce((a, b) => a + b, 0) + otherReceivingYards;
      const rushers = context.usable.filter(p => ['QB', 'RB'].includes(p.position) && context.cohorts.has(`${p.id}:rushing`));
      const rushingSamples = rushers.map(p => sample(p, 'rushing'));
      const rushShares = rushingSamples.map(row => row.player.rushingAttempts! / Math.max(1, row.team.rushingAttempts));
      const attempts = Math.max(0, Math.round((own.rushingAttempts + allowed.rushingAttempts) / 2));
      const carries = allocate(attempts, [...rushShares, Math.max(.1, 1 - rushShares.reduce((a, b) => a + b, 0))]);
      const baseRushing = rushers.map((_p, i) => {
        const observed = rushingSamples[i].player;
        return Math.max(0, Math.round(carries[i] * observed.rushingYards! / Math.max(1, observed.rushingAttempts!) * context.rushAdjustment));
      });
      const rushing = baseRushing.map(yards => Math.round(yards * learned.rushingYards));
      const baseOtherRushingYards = Math.max(0, Math.round(carries[carries.length - 1] * Math.max(0, own.rushingYards / Math.max(1, own.rushingAttempts)) * context.rushAdjustment));
      const otherRushingYards = Math.round(baseOtherRushingYards * learned.rushingYards);
      const rushingYards = rushing.reduce((a, b) => a + b, 0) + otherRushingYards;
      const stochasticCount = (value: number) => Math.floor(value) + (random() < value - Math.floor(value) ? 1 : 0);
      const passProposal = Math.min(completions, stochasticCount(passAttempts * qbStats.passingTouchdowns! / qbStats.passingAttempts! * context.passTDAdjustment));
      const receivingTD = allocateCapped(passProposal, [...receivingSamples.map(row => row.player.receivingTouchdowns! / Math.max(1, row.team.passingTouchdowns)),
        Math.max(.1, 1 - receivingSamples.reduce((sum, row) => sum + row.player.receivingTouchdowns! / Math.max(1, row.team.passingTouchdowns), 0))], catches);
      const passingTouchdowns = receivingTD.reduce((a, b) => a + b, 0), otherReceivingTouchdowns = receivingTD[receivingTD.length - 1];
      const rushingTD = rushingSamples.map((row, i) => Math.min(carries[i], stochasticCount(carries[i] * row.player.rushingTouchdowns! / Math.max(1, row.player.rushingAttempts!) * context.rushTDAdjustment)));
      const otherRushingTouchdowns = Math.min(carries[carries.length - 1], stochasticCount(carries[carries.length - 1] * own.rushingTouchdowns / Math.max(1, own.rushingAttempts) * context.rushTDAdjustment));
      const rushingTouchdowns = rushingTD.reduce((a, b) => a + b, 0) + otherRushingTouchdowns;
      const stats: TeamDraw['stats'] = { [qb.id]: { passingAttempts: passAttempts, completions, passingYards, passingTouchdowns } };
      receivers.forEach((p, i) => { stats[p.id] = { ...stats[p.id], receptions: catches[i], receivingYards: receiverYards[i], receivingTouchdowns: receivingTD[i] }; });
      rushers.forEach((p, i) => { stats[p.id] = { ...stats[p.id], rushingAttempts: carries[i], rushingYards: rushing[i], rushingTouchdowns: rushingTD[i] }; });
      const scoringRate = (own.points + allowed.points) / Math.max(1, own.passingYards + own.rushingYards + allowed.passingYards + allowed.rushingYards);
      const baseYards = baseReceiverYards.reduce((a, b) => a + b, baseOtherReceivingYards) + baseRushing.reduce((a, b) => a + b, baseOtherRushingYards);
      const points = Math.max(6 * (passingTouchdowns + rushingTouchdowns), Math.round(baseYards * scoringRate * context.scoringAdjustment * learned.score));
      return { points, stats, passingYards, rushingYards, receptions: completions, otherReceivingYards, otherReceptions, otherRushingYards,
        passingTouchdowns, rushingTouchdowns, otherReceivingTouchdowns, otherRushingTouchdowns };
    };
    const homeDraws: TeamDraw[] = [], awayDraws: TeamDraw[] = [];
    let homeWins = 0, awayWins = 0, ties = 0;
    for (let i = 0; i < runs; i++) {
      const homeSample = draw(homeRows, homeWeight, random), awaySample = draw(awayRows, awayWeight, random);
      const home = teamDraw(homeSample.own, awaySample.opponent, homeQB, homeSetup), away = teamDraw(awaySample.own, homeSample.opponent, awayQB, awaySetup);
      homeDraws.push(home); awayDraws.push(away);
      if (home.points > away.points) homeWins++; else if (away.points > home.points) awayWins++; else ties++;
    }
    const finish = (team: SimulationGame['home'], context: ReturnType<typeof setup>, draws: TeamDraw[], wins: number): SimulationTeamResult => ({
      ...team, score: simulationRange(draws.map(row => row.points)), winProbability: wins / runs,
      matchup: { passingYardsMultiplier: context.passAdjustment, rushingYardsMultiplier: context.rushAdjustment },
      totals: Object.fromEntries((['passingYards', 'rushingYards', 'receptions', 'otherReceivingYards', 'otherReceptions', 'otherRushingYards',
        'passingTouchdowns', 'rushingTouchdowns', 'otherReceivingTouchdowns', 'otherRushingTouchdowns'] as const)
        .map(key => [key, simulationRange(draws.map(row => row[key]))])) as SimulationTeamTotals,
      players: players.filter(p => p.teamId === team.id && (p.position !== 'QB' || context.active.some(active => active.id === p.id))).map(p => {
        const observed = observations.get(p.id) ?? [], usable = context.usable.some(row => row.id === p.id);
        const keys = usable ? Object.keys(draws[0].stats[p.id] ?? {}) as Array<keyof SimulationStat> : [];
        return { id: p.id, name: p.name, position: p.position, games: observed.length, priorTeams: [...new Set(observed.map(row => row.teamId))],
          headToHeadGames: observed.filter(row => row.opponentId === (team.id === game.home.id ? game.away.id : game.home.id)).length,
          status: p.status, role: p.role, limited: keys.length > 0 && [...context.cohorts.entries()].some(([key, cohort]) => key.startsWith(`${p.id}:`) && cohort.rows.length < 8),
          stats: Object.fromEntries(keys.map(key => [key, simulationRange(draws.map(row => row.stats[p.id]![key]!))])),
          issue: p.excluded ? 'Excluded by reported availability; no zero-valued projection is substituted.' : !usable ? 'Fewer than four verified production appearances; included only in unmodeled team remainder.' : !keys.length ? 'No supported market was recorded.' : null };
      }),
    });
    results.push({ id, label, quarterbacks, issue: null, home: finish(game.home, homeSetup, homeDraws, homeWins), away: finish(game.away, awaySetup, awayDraws, awayWins), tieProbability: ties / runs });
  }
  return results;
}
