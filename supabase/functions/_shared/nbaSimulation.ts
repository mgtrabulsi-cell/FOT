import { array, numeric, object, text } from './gamewaire.ts';
import type { LearningAdjustment } from './gamewireLearning.ts';

export const nbaSimulationVersion = 'nba-joint-bootstrap-v1';
export const nbaSimulationRuns = 1000;
export const nbaSimulationLockLead = 30 * 60000;
export type NBAStatLine = { points: number; rebounds: number; assists: number; minutes: number };
export type NBASimulationTeam = { id: string; name: string; abbr: string };
export type NBASimulationGame = { id: string; date: string; season: number; seasonType: 2 | 3;
  home: NBASimulationTeam; away: NBASimulationTeam };
export type NBAReference = { id: string; date: string; teamId: string; opponentId: string };
export type NBAObservation = { id: string; date: string; season: number; home: boolean; teamId: string; opponentId: string;
  points: number; allowed: number; possessions: number; allowedRebounds: number; allowedAssists: number;
  players: Record<string, NBAStatLine>; completePlayers?: boolean };
export type NBASimulationPlayer = { id: string; name: string; teamId: string; position: string; status: string; excluded: boolean };
export type NBARange = { mean: number; p10: number; p90: number };
export type NBAPlayerProjection = NBASimulationPlayer & { games: number; limited: boolean; stats: Record<keyof NBAStatLine | 'pra', NBARange>;
  matchup: string };
export type NBATeamProjection = NBASimulationTeam & { score: NBARange; winProbability: number; players: NBAPlayerProjection[];
  pace: number; offensiveRating: number; opponentDefensiveRating: number };
export type NBASimulationLearning = { score: LearningAdjustment; pra: LearningAdjustment };
export type NBAGameSimulation = { version: string; eventId: string; kickoff: string; season: number; seasonType: 2 | 3;
  homeTeamId: string; awayTeamId: string; status: 'collecting' | 'ready' | 'unavailable'; checkedAt: string; forecastAt: string | null;
  lockedAt: string | null; availabilityKey: string; stage: string; runs: number; calibrated: false; refreshing: boolean;
  history: { home: number; away: number; target: number }; progress: { completed: number; total: number };
  warnings: string[]; injuries: NBASimulationPlayer[]; home: NBATeamProjection | null; away: NBATeamProjection | null;
  learning?: NBASimulationLearning; baseline?: { homeScore: number; awayScore: number; players: Array<{ id: string; teamId: string; pra: number }> } };
export type NBAActuals = { home: { id: string; score: number; players: Record<string, NBAStatLine> };
  away: { id: string; score: number; players: Record<string, NBAStatLine> } };
export type NBAResult = { eventId: string; kickoff: string; forecast: NBAGameSimulation; actuals: NBAActuals | null; settledAt: string | null };
export type NBAAccuracyReport = { games: NBAResult[]; issues: string[] };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validId = (value: unknown) => typeof value === 'string' && /^\d{1,12}$/.test(value);
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const round = (n: number) => Math.round(n * 100) / 100;
const statKeys = ['points', 'rebounds', 'assists', 'minutes'] as const;
export function readNBASimulationGame(raw: unknown, eventId: string): NBASimulationGame {
  const header = object(object(raw).header), season = object(header.season);
  const competition = object(array(header.competitions)[0]);
  const sides = array(competition.competitors).map(object);
  const team = (side: string): NBASimulationTeam => {
    const row = object(sides.find(row => row.homeAway === side)?.team);
    if (!validId(text(row.id)) || !text(row.displayName) || !text(row.abbreviation)) throw new Error('NBA matchup teams are unavailable.');
    return { id: text(row.id), name: text(row.displayName), abbr: text(row.abbreviation) };
  };
  if (text(header.id) !== eventId || !validId(eventId) || !validDate(competition.date)
    || !Number.isInteger(season.year) || Number(season.year) < 2000 || Number(season.year) > 2200
    || ![2, 3].includes(Number(season.type))) throw new Error('A verified regular-season or playoff NBA matchup is required.');
  const game = { id: eventId, date: competition.date, season: Number(season.year), seasonType: Number(season.type) as 2 | 3,
    home: team('home'), away: team('away') };
  if (game.home.id === game.away.id) throw new Error('NBA matchup teams must be distinct.');
  return game;
}
export function nbaSimulationSchedule(raw: unknown, teamId: string, cutoff: number): NBAReference[] {
  const row = object(raw);
  if (!Array.isArray(row.events)) throw new Error('NBA completed-game schedule is unavailable.');
  if (text(object(row.team).id) && text(object(row.team).id) !== teamId) throw new Error('NBA schedule returned a different team.');
  return row.events.flatMap(value => {
    const event = object(value), competition = object(array(event.competitions)[0]);
    const sides = array(competition.competitors).map(object);
    const opponent = sides.find(side => text(object(side.team).id) !== teamId);
    const phase = numeric(object(event.season).type) ?? numeric(object(row.season).type);
    if (!validId(text(event.id)) || !validDate(event.date) || Date.parse(event.date) >= cutoff
      || object(object(competition.status).type).completed !== true || phase !== undefined && ![2, 3].includes(phase)
      || !sides.some(side => text(object(side.team).id) === teamId) || !validId(text(object(opponent?.team).id))) return [];
    return [{ id: text(event.id), date: event.date, teamId, opponentId: text(object(opponent?.team).id) }];
  });
}
export function nbaSimulationRoster(raw: unknown, teamId: string): NBASimulationPlayer[] {
  const root = object(raw);
  if (!Array.isArray(root.athletes) || text(object(root.team).id) && text(object(root.team).id) !== teamId)
    throw new Error('NBA roster or team identity is unavailable.');
  const rows = root.athletes.flatMap(entry => Array.isArray(object(entry).items) ? array(object(entry).items) : [entry]);
  const players = rows.map(value => {
    const row = object(value), injuries = array(row.injuries).map(value => text(object(value).status)).filter(Boolean);
    const status = [...injuries, text(object(row.status).type) || text(object(row.status).name)].filter(Boolean).join(' / ') || 'Availability unverified';
    return { id: text(row.id), name: text(row.displayName) || text(row.fullName), position: text(object(row.position).abbreviation),
      teamId, status, excluded: /\b(out|inactive|suspended|injured reserve)\b/i.test(status) };
  });
  if (!players.length || players.some(row => !validId(row.id) || !row.name) || new Set(players.map(row => row.id)).size !== players.length)
    throw new Error('NBA roster contains missing or ambiguous player identities.');
  return players;
}
export function nbaAvailabilityKey(players: NBASimulationPlayer[]) {
  return players.map(player => `${player.teamId}:${player.id}:${player.status}`).sort().join('|');
}
function statLine(names: unknown, values: unknown): NBAStatLine | null {
  const labels = array(names).map(text), stats = array(values);
  const read = (label: string) => {
    const index = labels.indexOf(label);
    return index < 0 ? undefined : numeric(stats[index]);
  };
  const index = labels.indexOf('MIN'), minuteText = index < 0 ? '' : text(stats[index]);
  const time = minuteText.match(/^(\d+):(\d{2})$/);
  const minutes = time && Number(time[2]) < 60 ? Number(time[1]) + Number(time[2]) / 60 : read('MIN');
  const points = read('PTS'), rebounds = read('REB'), assists = read('AST');
  if (![points, rebounds, assists, minutes].every(n => n !== undefined && Number.isFinite(n) && n >= 0)) return null;
  return { points: points!, rebounds: rebounds!, assists: assists!, minutes: minutes! };
}
export function nbaSimulationBox(raw: unknown, eventId: string, cutoff: number): NBAObservation[] {
  const game = readNBASimulationGame(raw, eventId), data = object(raw);
  const competition = object(array(object(data.header).competitions)[0]);
  if (Date.parse(game.date) >= cutoff || object(object(competition.status).type).completed !== true)
    throw new Error('Only verified completed NBA games before the forecast cutoff may be sampled.');
  const competitors = array(competition.competitors).map(object), box = object(data.boxscore);
  const allPlayers = array(box.players).map(object);
  const side = (team: NBASimulationTeam) => {
    const competitor = competitors.find(row => text(object(row.team).id) === team.id);
    const score = numeric(competitor?.score);
    const totals = object(array(box.teams).map(object).find(row => text(object(row.team).id) === team.id));
    const stats = array(totals.statistics).map(object);
    const number = (name: string) => numeric(stats.find(row => row.name === name)?.displayValue);
    const attempts = (name: string) => {
      const pair = text(stats.find(row => row.name === name)?.displayValue).match(/^\d+-(\d+)$/);
      return pair ? Number(pair[1]) : undefined;
    };
    const fga = attempts('fieldGoalsMade-fieldGoalsAttempted'), fta = attempts('freeThrowsMade-freeThrowsAttempted');
    const oreb = number('offensiveRebounds'), turnovers = number('totalTurnovers') ?? number('turnovers');
    const rebounds = number('totalRebounds'), assists = number('assists');
    if (![score, fga, fta, oreb, turnovers, rebounds, assists].every(n => n !== undefined && n >= 0))
      throw new Error('NBA final team statistics are incomplete; missing values are not zero.');
    const possessions = fga! + .44 * fta! - oreb! + turnovers!;
    if (possessions < 40 || possessions > 200) throw new Error('NBA possession evidence is outside valid game bounds.');
    const players: Record<string, NBAStatLine> = {};
    for (const category of array(allPlayers.find(row => text(object(row.team).id) === team.id)?.statistics).map(object)) {
      for (const value of array(category.athletes)) {
        const row = object(value), id = text(object(row.athlete).id);
        if (row.didNotPlay === true || !validId(id)) continue;
        const line = statLine(category.labels ?? category.names, row.stats);
        if (line && line.minutes > 0) {
          if (players[id]) throw new Error('NBA final contains duplicate player stat lines.');
          players[id] = line;
        }
      }
    }
    const personal = Object.values(players);
    const completePlayers = personal.reduce((sum, row) => sum + row.points, 0) === score!
      && personal.reduce((sum, row) => sum + row.minutes, 0) >= 238;
    return { score: score!, possessions, rebounds: rebounds!, assists: assists!, players, completePlayers };
  };
  const home = side(game.home), away = side(game.away);
  return ([['home', home, away], ['away', away, home]] as const).map(([key, own, opponent]) => ({
    id: game.id, date: game.date, season: game.season, home: key === 'home', teamId: game[key].id,
    opponentId: game[key === 'home' ? 'away' : 'home'].id, points: own.score, allowed: opponent.score,
    possessions: (own.possessions + opponent.possessions) / 2, allowedRebounds: opponent.rebounds,
    allowedAssists: opponent.assists, players: own.players, completePlayers: own.completePlayers,
  }));
}
function seeded(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
function range(values: number[]): NBARange {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: round(mean(values)), p10: round(sorted[Math.floor((sorted.length - 1) * .1)]),
    p90: round(sorted[Math.floor((sorted.length - 1) * .9)]) };
}
export function pendingNBASimulation(game: NBASimulationGame, now: number): NBAGameSimulation {
  return { version: nbaSimulationVersion, eventId: game.id, kickoff: game.date, season: game.season, seasonType: game.seasonType,
    homeTeamId: game.home.id, awayTeamId: game.away.id, status: 'collecting', checkedAt: new Date(now).toISOString(),
    forecastAt: null, lockedAt: null, availabilityKey: '', stage: 'Queued for automatic preparation', runs: 0, calibrated: false,
    refreshing: false, history: { home: 0, away: 0, target: 100 }, progress: { completed: 0, total: 200 },
    warnings: [], injuries: [], home: null, away: null };
}
export function simulateNBAGame(game: NBASimulationGame, observations: NBAObservation[], roster: NBASimulationPlayer[],
  now: number, learning?: NBASimulationLearning): NBAGameSimulation {
  if (!Number.isFinite(now) || now >= Date.parse(game.date)) throw new Error('NBA forecasts cannot be generated at or after tipoff.');
  const cutoff = Math.min(now, Date.parse(game.date)), warnings: string[] = [];
  const history = (teamId: string) => [...new Map(observations.filter(row => row.teamId === teamId
    && validDate(row.date) && Date.parse(row.date) < cutoff && row.id !== game.id).map(row => [row.id, row])).values()]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 100);
  const home = history(game.home.id), away = history(game.away.id);
  const base = pendingNBASimulation(game, now);
  base.history = { home: home.length, away: away.length, target: 100 };
  base.progress = { completed: home.length + away.length, total: 200 };
  base.availabilityKey = nbaAvailabilityKey(roster);
  base.injuries = roster.filter(row => row.excluded || !/\bactive\b/i.test(row.status) || /questionable|doubtful|probable|day.to.day/i.test(row.status));
  if (home.length < 8 || away.length < 8) return { ...base, stage: 'Collecting at least eight completed games per team',
    warnings: ['Insufficient verified team evidence. No score or player projection has been invented.'] };
  if (home.length < 100 || away.length < 100) warnings.push('Limited history: fewer than 100 completed games per team. Backfill continues before the pregame lock.');
  const random = seeded(`${nbaSimulationVersion}:${game.id}:${game.date}:${base.availabilityKey}`);
  const weighted = (rows: NBAObservation[]) => {
    const weights = rows.map((row, i) => (row.season === game.season ? 2 : 1) * (i < 10 ? 2 : 1));
    const total = weights.reduce((sum, n) => sum + n, 0);
    return () => { let n = random() * total; return rows[weights.findIndex(weight => (n -= weight) < 0)] ?? rows[rows.length - 1]; };
  };
  const availabilityHistory = (rows: NBAObservation[], team: NBASimulationTeam) => {
    const out = roster.filter(player => player.teamId === team.id && player.excluded && rows.filter(row =>
      (row.players[player.id]?.minutes ?? 0) >= 10).length >= 3);
    if (!out.length) return rows;
    const matched = rows.filter(row => row.completePlayers && out.every(player => !row.players[player.id]));
    if (matched.length >= 8) {
      warnings.push(`${team.abbr}: scoring and role samples use ${matched.length} fully accounted games without the currently out rotation players.`);
      return matched;
    }
    warnings.push(`${team.abbr}: insufficient verified games without the currently out rotation players. Team scoring has no injury-specific adjustment; named player projections still exclude them.`);
    return rows;
  };
  const homePool = availabilityHistory(home, game.home), awayPool = availabilityHistory(away, game.away);
  const pickHome = weighted(homePool), pickAway = weighted(awayPool), combined = [...homePool, ...awayPool];
  const sampledRating = mean(combined.map(row => row.points / row.possessions * 100));
  const sampledRebounds = mean(combined.map(row => row.allowedRebounds / row.possessions));
  const sampledAssists = mean(combined.map(row => row.allowedAssists / row.possessions));
  const teamRuns = { home: [] as number[], away: [] as number[] };
  const playerRuns = new Map<string, Record<keyof NBAStatLine | 'pra', number[]>>();
  const preparePlayers = (rows: NBAObservation[], opponent: NBAObservation[], team: NBASimulationTeam) => {
    const candidates = roster.filter(player => player.teamId === team.id && !player.excluded).flatMap(player => {
      const samples = rows.filter(row => row.players[player.id]?.minutes > 0);
      if (samples.length < 3) { warnings.push(`${player.name}: fewer than three verified appearances; no personal projection.`); return []; }
      const recent = samples.slice(0, 10), minutes = mean(recent.map(row => row.players[player.id].minutes));
      if (minutes < 3) return [];
      const total = samples.reduce((sum, row) => sum + row.players[player.id].minutes, 0);
      const rate = (stat: 'points' | 'rebounds' | 'assists') => samples.reduce((sum, row) => sum + row.players[player.id][stat], 0) / total;
      return [{ player, samples, minutes: clamp(minutes, 0, 48), draw: weighted(samples),
        foundation: { points: rate('points'), rebounds: rate('rebounds'), assists: rate('assists') } }];
    });
    const totalMinutes = candidates.reduce((sum, player) => sum + player.minutes, 0);
    if (totalMinutes > 240) for (const player of candidates) player.minutes *= 240 / totalMinutes;
    if (candidates.length < 5) warnings.push(`${team.abbr}: fewer than five players have verified personal samples; missing rotation production is not allocated to named players.`);
    const pointsFactor = clamp(mean(opponent.slice(0, 20).map(row => row.allowed / row.possessions * 100)) / sampledRating, .85, 1.15);
    const reboundsFactor = clamp(mean(opponent.slice(0, 20).map(row => row.allowedRebounds / row.possessions)) / sampledRebounds, .85, 1.15);
    const assistsFactor = clamp(mean(opponent.slice(0, 20).map(row => row.allowedAssists / row.possessions)) / sampledAssists, .85, 1.15);
    return { candidates, pointsFactor, reboundsFactor, assistsFactor };
  };
  const hp = preparePlayers(homePool, awayPool, game.home), ap = preparePlayers(awayPool, homePool, game.away);
  let homeWins = 0;
  for (let run = 0; run < nbaSimulationRuns; run++) {
    const h = pickHome(), a = pickAway(), pace = (h.possessions + a.possessions) / 2;
    // Sample complete P/R/A lines together to retain each player's observed stat covariance.
    for (const [key, own, opponent, prepared] of [['home', h, a, hp], ['away', a, h, ap]] as const) {
      const rate = (own.points / own.possessions + opponent.allowed / opponent.possessions) / 2;
      const score = Math.max(0, Math.round(rate * pace));
      teamRuns[key].push(score);
      for (const candidate of prepared.candidates) {
        const sample = candidate.draw(), line = sample.players[candidate.player.id];
        const exposure = candidate.minutes * pace / sample.possessions;
        // A 12-minute personal-rate prior prevents a one-minute cameo becoming a full-game outlier.
        const rate = (stat: 'points' | 'rebounds' | 'assists') => (line[stat] + candidate.foundation[stat] * 12) / (line.minutes + 12);
        const points = rate('points') * exposure * prepared.pointsFactor;
        const rebounds = rate('rebounds') * exposure * prepared.reboundsFactor;
        const assists = rate('assists') * exposure * prepared.assistsFactor;
        const id = `${candidate.player.teamId}:${candidate.player.id}`;
        const stats = playerRuns.get(id) ?? { points: [], rebounds: [], assists: [], minutes: [], pra: [] };
        stats.points.push(points); stats.rebounds.push(rebounds); stats.assists.push(assists);
        stats.minutes.push(candidate.minutes); stats.pra.push(points + rebounds + assists); playerRuns.set(id, stats);
      }
    }
    const hScore = teamRuns.home[run], aScore = teamRuns.away[run];
    homeWins += hScore > aScore ? 1 : hScore === aScore ? .5 : 0;
  }
  const projection = (team: NBASimulationTeam, rows: NBAObservation[], opponent: NBAObservation[], key: 'home' | 'away', prepared: typeof hp): NBATeamProjection => ({
    ...team, score: range(teamRuns[key].map(n => n * (learning?.score.adjustment ?? 1))), winProbability: key === 'home' ? homeWins / nbaSimulationRuns : 1 - homeWins / nbaSimulationRuns,
    pace: round(mean([...rows, ...opponent].map(row => row.possessions))), offensiveRating: round(mean(rows.map(row => row.points / row.possessions * 100))),
    opponentDefensiveRating: round(mean(opponent.map(row => row.allowed / row.possessions * 100))),
    players: prepared.candidates.map(({ player, samples }) => {
      const stats = playerRuns.get(`${player.teamId}:${player.id}`)!;
      const adjusted = (key: 'points' | 'rebounds' | 'assists' | 'pra') => range(stats[key].map(n => n * (learning?.pra.adjustment ?? 1)));
      return { ...player, games: samples.length, limited: samples.length < 8, stats: {
        points: adjusted('points'), rebounds: adjusted('rebounds'), assists: adjusted('assists'), minutes: range(stats.minutes), pra: adjusted('pra') },
        matchup: `${prepared.pointsFactor >= 1.02 ? 'Scoring runway' : prepared.pointsFactor <= .98 ? 'Tough scoring test' : 'Balanced scoring matchup'} · ${samples.length} sampled appearances; recent-minute role, not a confirmed starter.`,
      };
    }).sort((a, b) => b.stats.pra.mean - a.stats.pra.mean || a.id.localeCompare(b.id)),
  });
  warnings.push('Experimental, uncalibrated estimates, not betting recommendations. P10–P90 is sampled variation, not a calibrated confidence interval.',
    'Team scores and individual lines are modeled separately; unlisted rotation production is not invented. Historical finals include overtime.');
  if (base.injuries.length) warnings.push('Availability-sensitive forecast: out/inactive players are excluded; uncertain players are conditional on playing.');
  return { ...base, status: 'ready', stage: 'Simulation complete', forecastAt: new Date(now).toISOString(),
    lockedAt: now >= Date.parse(game.date) - nbaSimulationLockLead ? new Date(now).toISOString() : null,
    runs: nbaSimulationRuns, warnings, home: projection(game.home, homePool, awayPool, 'home', hp),
    away: projection(game.away, awayPool, homePool, 'away', ap), ...(learning ? { learning } : {}),
    baseline: { homeScore: round(mean(teamRuns.home)), awayScore: round(mean(teamRuns.away)),
      players: [...hp.candidates, ...ap.candidates].map(({ player }) => ({ id: player.id, teamId: player.teamId,
        pra: round(mean(playerRuns.get(`${player.teamId}:${player.id}`)!.pra)) })) } };
}
export function readNBAGameSimulation(value: unknown, eventId: string, kickoff: string, teams: { home: string; away: string }): NBAGameSimulation {
  const row = object(value), history = object(row.history), progress = object(row.progress);
  const count = (n: unknown) => finite(n) && Number.isInteger(n) && n >= 0;
  const validRange = (value: unknown) => { const r = object(value); return [r.mean, r.p10, r.p90].every(n => finite(n) && n >= 0) && Number(r.p10) <= Number(r.p90); };
  const validPlayer = (value: unknown, teamId: string) => {
    const p = object(value);
    return validId(p.id) && typeof p.name === 'string' && !!p.name && p.teamId === teamId && typeof p.position === 'string'
      && typeof p.status === 'string' && p.excluded === false && count(p.games) && Number(p.games) >= 3 && typeof p.limited === 'boolean'
      && typeof p.matchup === 'string' && [...statKeys, 'pra'].every(stat => validRange(object(p.stats)[stat]));
  };
  const validTeam = (value: unknown, id: string) => {
    const t = object(value);
    return t.id === id && typeof t.name === 'string' && typeof t.abbr === 'string' && validRange(t.score)
      && finite(t.winProbability) && t.winProbability >= 0 && t.winProbability <= 1
      && [t.pace, t.offensiveRating, t.opponentDefensiveRating].every(n => finite(n) && n > 0)
      && Array.isArray(t.players) && t.players.every(p => validPlayer(p, id))
      && new Set(t.players.map(p => object(p).id)).size === t.players.length;
  };
  if (row.version !== nbaSimulationVersion || row.eventId !== eventId || !validDate(row.kickoff) || Date.parse(row.kickoff) !== Date.parse(kickoff)
    || row.homeTeamId !== teams.home || row.awayTeamId !== teams.away || teams.home === teams.away
    || !validId(eventId) || !validId(teams.home) || !validId(teams.away)
    || !['collecting', 'ready', 'unavailable'].includes(String(row.status)) || !validDate(row.checkedAt)
    || !count(row.season) || Number(row.season) < 2000 || Number(row.season) > 2200
    || ![2, 3].includes(Number(row.seasonType)) || row.calibrated !== false || typeof row.refreshing !== 'boolean'
    || ![history.home, history.away, progress.completed, progress.total].every(count) || history.target !== 100
    || Number(history.home) > 100 || Number(history.away) > 100 || progress.total !== 200
    || progress.completed !== Number(history.home) + Number(history.away)
    || typeof row.stage !== 'string' || typeof row.availabilityKey !== 'string'
    || !Array.isArray(row.warnings) || !row.warnings.every(n => typeof n === 'string')
    || !Array.isArray(row.injuries) || !row.injuries.every(n => typeof object(n).name === 'string' && typeof object(n).status === 'string')
    || row.lockedAt !== null && (!validDate(row.lockedAt) || Date.parse(row.lockedAt) >= Date.parse(kickoff))
    || row.status === 'ready' && (!validDate(row.forecastAt) || Date.parse(row.forecastAt) >= Date.parse(kickoff)
      || Number(history.home) < 8 || Number(history.away) < 8 || row.runs !== nbaSimulationRuns || !validTeam(row.home, teams.home) || !validTeam(row.away, teams.away))
    || row.status !== 'ready' && (row.forecastAt !== null || row.home !== null || row.away !== null))
    throw new Error('The NBA simulation does not match the game or contains invalid forecast data.');
  return value as NBAGameSimulation;
}
export function nbaDailyPerformers(forecasts: NBAGameSimulation[], date: string) {
  const day = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const players = forecasts.filter(row => row.status === 'ready' && day(row.kickoff) === date)
    .flatMap(forecast => [forecast.home, forecast.away].flatMap(team => team?.players.filter(player => player.stats.minutes.mean >= 10)
      .map(player => ({ ...player, eventId: forecast.eventId, kickoff: forecast.kickoff, team: team.abbr,
        opponent: team.id === forecast.homeTeamId ? forecast.away!.abbr : forecast.home!.abbr, forecastAt: forecast.forecastAt })) ?? []))
    .sort((a, b) => b.stats.pra.mean - a.stats.pra.mean || a.id.localeCompare(b.id));
  return players.filter((player, index) => players.findIndex(row => row.id === player.id) === index).slice(0, 3);
}
