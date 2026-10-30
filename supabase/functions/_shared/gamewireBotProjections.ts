import { array, numeric, object, text } from './gamewaire.ts';
import { botLogRows } from './gamewireBot.ts';
import type { BotDirectory, BotMatchup, BotPlayer } from './gamewireBot.ts';

export type BotProjection = {
  market: string; label: string; estimate: number | null; unit: 'yards' | 'receptions'; baseline: number | null; playerGames: number;
  yards: number | null; // Kept for older clients during the frontend rollout.
  defenseAverage: number | null; defenseGames: number; share: number | null;
  historyAverage: number | null; historyGames: number; contenderAverage: number | null; contenderGames: number;
  context: string; explanation: string; warnings: string[];
  role?: { rank: number; source: 'depth-chart' | 'recent-usage' } | null;
  defenseRank?: number | null; limitedData?: boolean;
  basis?: 'matchup' | 'current-season';
  sourceGames: Array<{ id: string; date: string; role: 'team' | 'opponent' }>;
};
type ScheduledGame = { id: string; date: string; opponentId: string; pointsFor: number; pointsAgainst: number };
type Schedule = { games: ScheduledGame[]; standing: string };
const site = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Math.round(value * 10) / 10;
const receptions = { market: 'player_receptions', label: 'Receptions', category: 'receiving', column: 'receptions' };
const metrics: Record<string, Array<{ market: string; label: string; category: string; column: string }>> = {
  QB: [{ market: 'player_pass_yds', label: 'Passing yards', category: 'passing', column: 'passingYards' }, { market: 'player_rush_yds', label: 'Rushing yards', category: 'rushing', column: 'rushingYards' }],
  RB: [{ market: 'player_rush_yds', label: 'Rushing yards', category: 'rushing', column: 'rushingYards' }, { market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }, receptions],
  WR: [{ market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }, receptions],
  TE: [{ market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }, receptions],
};
export function projectionSchedule(value: unknown, teamId: string, season: number, cutoff: number): Schedule {
  const data = object(value), team = object(data.team);
  if (text(team.id) !== teamId || numeric(object(data.season).year) !== season || numeric(object(data.season).type) !== 2 || !Array.isArray(data.events))
    throw new Error('The schedule did not match the requested team and regular season.');
  const games: ScheduledGame[] = [];
  for (const raw of data.events) {
    const event = object(raw), competition = object(array(event.competitions)[0]);
    if (object(object(competition.status).type).completed !== true || Date.parse(text(event.date)) >= cutoff) continue;
    const sides = array(competition.competitors).map(object), own = sides.find((row) => text(object(row.team).id) === teamId), other = sides.find((row) => row !== own);
    const a = numeric(object(own?.score).value), b = numeric(object(other?.score).value);
    if (!own || !other || a === undefined || b === undefined || !/^\d+$/.test(text(event.id))
      || !/^\d{1,2}$/.test(text(object(other.team).id)) || !Number.isFinite(Date.parse(text(event.date)))) continue;
    games.push({ id: text(event.id), date: text(event.date), opponentId: text(object(other.team).id), pointsFor: a, pointsAgainst: b });
  }
  return { games: games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), standing: text(team.standingSummary) };
}
function completedMetricRows(value: unknown, eventId: string, offenseId: string, season: number, category: string, column: string) {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]);
  if (text(header.id) !== eventId || numeric(object(header.season).year) !== season || numeric(object(header.season).type) !== 2
    || object(object(competition.status).type).completed !== true) throw new Error('A box score did not confirm the requested completed regular-season game.');
  const offense = array(object(data.boxscore).players).map(object).find((row) => text(object(row.team).id) === offenseId);
  const stats = array(offense?.statistics).map(object).find((row) => row.name === category), index = array(stats?.keys).indexOf(column);
  if (!stats || index < 0 || !array(stats.athletes).length) throw new Error(`The box score does not report ${column}.`);
  return { rows: array(stats.athletes).map(object), index };
}
export function completedPlayerMetric(value: unknown, eventId: string, offenseId: string, season: number, category: string, column: string, playerId: string) {
  const { rows, index } = completedMetricRows(value, eventId, offenseId, season, category, column);
  const row = rows.find((row) => text(object(row.athlete).id) === playerId);
  if (!row) return null;
  const amount = numeric(array(row.stats)[index]);
  if (amount === undefined || column === 'receptions' && (amount < 0 || !Number.isInteger(amount)))
    throw new Error(`The player's completed box score has missing or invalid ${column}.`);
  return amount;
}
export function positionGameYards(value: unknown, eventId: string, offenseId: string, season: number, position: string,
  category: string, column: string, positions: Record<string, string>, playerId?: string) {
  const { rows, index } = completedMetricRows(value, eventId, offenseId, season, category, column);
  let total = 0, player: number | null = null, classified = false;
  for (const row of rows) {
    const athlete = object(row.athlete), id = text(athlete.id), yards = numeric(array(row.stats)[index]);
    if (yards === undefined) throw new Error(`A listed player has missing ${column} in the box score.`);
    if (column === 'receptions' && (yards < 0 || !Number.isInteger(yards))) throw new Error('A listed player has invalid receptions in the box score.');
    const rawPosition = text(object(athlete.position).abbreviation) || positions[id], role = rawPosition === 'FB' || rawPosition === 'HB' ? 'RB' : rawPosition;
    if (!role && yards !== 0) throw new Error('A player position could not be verified for the defensive sample.');
    if (role === position) { total += yards; classified = true; if (id === playerId) player = yards; }
  }
  if (!classified) throw new Error(`No verified ${position} position group was reported for this sample.`);
  return { total, player };
}
export function matchupEstimate(baseline: number, defenseAverage: number, share: number, history?: number, contenders?: number, decimals = 0) {
  if (![baseline, defenseAverage, share].every(Number.isFinite) || baseline <= 0 || defenseAverage < 0 || share < 0 || share > 1)
    throw new Error('Matchup estimates require positive verified production and a valid position share.');
  if ([history, contenders].some((value) => value !== undefined && !Number.isFinite(value))) throw new Error('Historical production components must be finite.');
  let estimate = .7 * baseline + .3 * defenseAverage * share;
  if (history !== undefined) estimate = .9 * estimate + .1 * history;
  if (contenders !== undefined) estimate = .95 * estimate + .05 * contenders;
  const scale = 10 ** decimals;
  return Math.round(Math.max(baseline * .75, Math.min(baseline * 1.25, estimate)) * scale) / scale;
}
export function readBotDepth(value: unknown, player: BotPlayer): BotProjection['role'] {
  const charts = array(object(value).depthchart);
  if (!charts.length) throw new Error('The public depth chart is unavailable.');
  const ranks = charts.flatMap((raw) => Object.entries(object(object(raw).positions)).flatMap(([key, rawSlot]) => {
    if (!new RegExp(`^${player.position.toLowerCase()}\\d*$`).test(key)) return [];
    const athletes = array(object(rawSlot).athletes).map(object);
    const index = athletes.findIndex((row) => text(row.id) === player.id && text(row.displayName) === player.name);
    return index < 0 ? [] : [index + 1];
  }));
  const unique = [...new Set(ranks)];
  return unique.length === 1 ? { rank: unique[0], source: 'depth-chart' } : null;
}
export type ReceivingDefense = { teamId: string; position: 'WR' | 'TE'; average: number; games: number; rank: number };
export async function collectReceivingDefenses(directory: BotDirectory, season: number, get: (url: string) => Promise<unknown>, now: number): Promise<ReceivingDefense[]> {
  const teams = [...new Set(directory.players.map((player) => player.teamId))];
  if (teams.length !== 32) throw new Error('All 32 teams are needed to verify bottom-four positional defenses.');
  const schedules = await settled(teams.map((id) => async () => ({ id, schedule: projectionSchedule(
    await get(`${site}/teams/${id}/schedule?season=${season}&seasontype=2`), id, season, now) })), 8);
  if (schedules.some((row) => row.status === 'rejected')) throw new Error('Some team schedules are unavailable; no bottom-four boost was applied.');
  const verified = schedules.flatMap((row) => row.status === 'fulfilled' ? [row.value] : []);
  const events = [...new Set(verified.flatMap(({ schedule }) => schedule.games.slice(0, 5).map((game) => game.id)))];
  const boxes = await settled(events.map((id) => async () => ({ id, box: await get(`${site}/summary?event=${id}`) })), 8);
  const byId = new Map(boxes.flatMap((row) => row.status === 'fulfilled' ? [[row.value.id, row.value.box] as const] : []));
  const result: ReceivingDefense[] = [];
  for (const position of ['WR', 'TE'] as const) {
    const rows = verified.map(({ id, schedule }) => {
      const values = schedule.games.slice(0, 5).flatMap((game) => {
        const box = byId.get(game.id);
        if (!box) return [];
        try { return [positionGameYards(box, game.id, game.opponentId, season, position, 'receiving', 'receivingYards', directory.positions).total]; }
        catch (cause) { console.error('Positional defense ranking sample excluded', id, game.id, position, cause); return []; }
      });
      return { teamId: id, position, average: values.length ? average(values) : 0, games: values.length };
    });
    // Incomplete league coverage cannot establish a league-wide bottom four.
    if (rows.some((row) => row.games < 3)) continue;
    for (const row of rows) result.push({ ...row, rank: 1 + rows.filter((other) => other.average < row.average).length });
  }
  if (!result.length) throw new Error('Insufficient verified league-wide WR/TE allowance samples; no bottom-four boost was applied.');
  return result;
}
async function settled<T>(work: Array<() => Promise<T>>, concurrency = 6) {
  const values: Array<PromiseSettledResult<T>> = [];
  for (let start = 0; start < work.length; start += concurrency) values.push(...await Promise.allSettled(work.slice(start, start + concurrency).map((load) => load())));
  return values;
}
const message = (value: unknown) => value instanceof Error ? value.message : 'Verified source unavailable.';
export async function collectBotProjections(player: BotPlayer, matchup: BotMatchup | null, season: number, currentLogs: unknown,
  directory: BotDirectory, get: (url: string) => Promise<unknown>, now: number,
  receivingDefenses: ReceivingDefense[] = []): Promise<BotProjection[]> {
  if (!matchup || matchup.state !== 'pre' || Date.parse(matchup.start) <= now) return [];
  const cutoff = Math.min(now, Date.parse(matchup.start)), warnings: string[] = [];
  const loadSchedule = async (id: string) => projectionSchedule(await get(`${site}/teams/${id}/schedule?season=${season}&seasontype=2`), id, season, cutoff);
  const [scheduleResults, depthResult] = await Promise.all([
    Promise.allSettled([loadSchedule(player.teamId), loadSchedule(matchup.opponentId)]),
    Promise.allSettled([get(`${site}/teams/${player.teamId}/depthcharts`)]),
  ]);
  const [ownResult, defenseResult] = scheduleResults;
  const own = ownResult.status === 'fulfilled' ? ownResult.value : null;
  const defense = defenseResult.status === 'fulfilled' ? defenseResult.value : null;
  if (!own) warnings.push(`Team schedule unavailable: ${ownResult.status === 'rejected' ? message(ownResult.reason) : 'Unverified schedule.'}`);
  if (!defense) warnings.push(`Opponent schedule unavailable: ${defenseResult.status === 'rejected' ? message(defenseResult.reason) : 'Unverified schedule.'}`);
  let current: ReturnType<typeof botLogRows> = [];
  try { if (currentLogs !== null) current = botLogRows(currentLogs, cutoff, season); }
  catch (cause) { console.error('Bot current logs unavailable; checking completed boxes', player.id, cause); warnings.push(`Player logs unavailable: ${message(cause)} Completed box scores are checked instead.`); }
  let depth: BotProjection['role'] = null;
  try {
    if (depthResult[0].status === 'rejected') throw depthResult[0].reason;
    depth = readBotDepth(depthResult[0].value, player);
    if (!depth) warnings.push('No unambiguous depth-chart role was found; recent measured usage is used when available.');
  } catch (cause) { console.error('Bot depth chart unavailable', player.id, cause); warnings.push(`Depth chart unavailable: ${message(cause)} Recent usage is not a confirmed starting role.`); }
  const ownGames = own?.games.slice(0, 5) ?? [], defenseGames = defense?.games.slice(0, 5) ?? [];
  const games = [...new Map([...ownGames, ...defenseGames].map((game) => [game.id, game])).values()];
  const boxes = new Map<string, unknown>();
  const boxResults = await settled(games.map((game) => async () => ({ id: game.id, data: await get(`${site}/summary?event=${game.id}`) })));
  boxResults.forEach((result) => {
    if (result.status === 'fulfilled') boxes.set(result.value.id, result.value.data);
    else { console.error('Bot position box score unavailable', result.reason); warnings.push(`A recent position-game sample is unavailable: ${message(result.reason)}`); }
  });
  const validMetric = (value: number | undefined | null, column: string): value is number =>
    typeof value === 'number' && Number.isFinite(value) && (column !== 'receptions' || Number.isInteger(value) && value >= 0);
  const missingMetrics = metrics[player.position].filter((metric) => {
    if (current.some((row) => validMetric(row.stats[metric.column], metric.column))) return false;
    return !ownGames.some((game) => {
      const box = boxes.get(game.id); if (!box) return false;
      try { return completedPlayerMetric(box, game.id, player.teamId, season, metric.category, metric.column, player.id) !== null; }
      catch (cause) { console.error('Bot recent individual box sample excluded', game.id, metric.column, cause); return false; }
    });
  });
  if (missingMetrics.length) {
    const olderGames = own?.games.slice(5, 18) ?? [];
    const olderResults = await settled(olderGames.map((game) => async () => ({ id: game.id, data: await get(`${site}/summary?event=${game.id}`) })));
    olderResults.forEach((result) => {
      if (result.status === 'fulfilled') boxes.set(result.value.id, result.value.data);
      else { console.error('Bot earlier current-season box unavailable', result.reason); warnings.push(`An earlier current-season player sample is unavailable: ${message(result.reason)}`); }
    });
  }
  const standingsContext = own && defense ? `${player.teamAbbr}: ${own.standing || 'division standing unavailable'}. ${matchup.opponent}: ${defense.standing || 'division standing unavailable'}.` : 'Current division standings are unavailable.';
  const bothContenders = !!own && !!defense && /^[12](?:st|nd)\s+in\b/i.test(own.standing) && /^[12](?:st|nd)\s+in\b/i.test(defense.standing);
  const contenderIds = new Set<string>();
  if (bothContenders && own) {
    const candidates = own.games.filter((game) => current.some((row) => row.eventId === game.id)).slice(0, 5);
    const opponents = [...new Set(candidates.map((game) => game.opponentId))];
    const schedules = await settled(opponents.map((id) => async () => ({ id, schedule: await loadSchedule(id) })));
    const byId = new Map(schedules.flatMap((result) => result.status === 'fulfilled' ? [[result.value.id, result.value.schedule] as const] : []));
    if (schedules.some((result) => result.status === 'rejected')) warnings.push('Some historical opponent records were unavailable; those contender-game splits are excluded.');
    const winningAtKickoff = (schedule: Schedule, date: string) => {
      const prior = schedule.games.filter((game) => Date.parse(game.date) < Date.parse(date));
      return prior.length >= 4 && prior.reduce((sum, game) => sum + (game.pointsFor > game.pointsAgainst ? 1 : game.pointsFor === game.pointsAgainst ? .5 : 0), 0) / prior.length >= .6;
    };
    for (const game of candidates) {
      const other = byId.get(game.opponentId);
      if (other && winningAtKickoff(own, game.date) && winningAtKickoff(other, game.date)) contenderIds.add(game.id);
    }
  }
  return metrics[player.position].map((metric) => {
    const unit = metric.column === 'receptions' ? 'receptions' : 'yards';
    const verifiedValues = new Map(current.filter((row) => validMetric(row.stats[metric.column], metric.column)).map((row) => [row.eventId, { date: row.date, value: row.stats[metric.column] }]));
    const problems = [...warnings], ownSamples: Array<{ total: number; player: number }> = [], allowed: number[] = [], sourceGames: BotProjection['sourceGames'] = [];
    for (const game of own?.games ?? []) {
      const box = boxes.get(game.id); if (!box) continue;
      try {
        const amount = completedPlayerMetric(box, game.id, player.teamId, season, metric.category, metric.column, player.id);
        if (amount !== null) {
          verifiedValues.set(game.id, { date: game.date, value: amount });
          sourceGames.push({ id: game.id, date: game.date, role: 'team' });
        }
      } catch (cause) { problems.push(`${game.id} ${metric.label} individual sample excluded: ${message(cause)}`); }
    }
    const usage = new Map<string, number>();
    for (const [type, source] of [['own', ownGames], ['defense', defenseGames]] as const) for (const game of source) {
      const box = boxes.get(game.id); if (!box) continue;
      try {
        const yards = positionGameYards(box, game.id, type === 'own' ? player.teamId : game.opponentId, season, player.position, metric.category, metric.column, directory.positions, player.id);
        if (type === 'defense') { allowed.push(yards.total); sourceGames.push({ id: game.id, date: game.date, role: 'opponent' }); }
        else if (yards.player !== null) {
          ownSamples.push({ total: yards.total, player: yards.player });
          const offense = array(object(object(box).boxscore).players).map(object).find((row) => text(object(row.team).id) === player.teamId);
          const stats = array(offense?.statistics).map(object).find((row) => row.name === metric.category);
          const keys = array(stats?.keys);
          const usageKey = metric.category === 'passing' ? 'passingAttempts' : metric.category === 'rushing' ? 'rushingAttempts' : 'receivingTargets';
          const index = keys.includes(usageKey) ? keys.indexOf(usageKey) : keys.indexOf(metric.column);
          for (const raw of array(stats?.athletes)) {
            const row = object(raw), athlete = object(row.athlete), id = text(athlete.id);
            const position = text(object(athlete.position).abbreviation) || directory.positions[id];
            const amount = numeric(array(row.stats)[index]);
            if ((position === player.position || player.position === 'RB' && ['HB', 'FB'].includes(position)) && amount !== undefined && amount >= 0)
              usage.set(id, (usage.get(id) ?? 0) + amount);
          }
        }
      } catch (cause) { problems.push(`${game.id} ${metric.label} sample excluded: ${message(cause)}`); }
    }
    const total = ownSamples.reduce((sum, row) => sum + row.total, 0);
    const rawShare = total > 0 ? ownSamples.reduce((sum, row) => sum + row.player, 0) / total : null;
    const share = rawShare !== null && rawShare >= 0 && rawShare <= 1 ? rawShare : null;
    const metricRows = [...verifiedValues.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const values = metricRows.map((row) => row.value);
    const rawBaseline = values.length ? Math.max(0, .65 * average(values.slice(0, 3)) + .35 * average(values)) : null;
    const usageAmount = usage.get(player.id);
    const role = depth ?? (usageAmount !== undefined && usageAmount > 0
      ? { rank: 1 + [...usage.values()].filter((value) => value > usageAmount).length, source: 'recent-usage' as const } : null);
    const roleCap = !role || role.rank === 1 ? 1 : player.position === 'QB' ? .15
      : player.position === 'WR' ? role.rank === 2 ? .4 : .25 : role.rank === 2 ? .4 : .2;
    const effectiveShare = share === null ? null : Math.min(share, roleCap);
    const baseline = rawBaseline === null ? null : share !== null && share > roleCap ? rawBaseline * roleCap / share : rawBaseline;
    const defenseAverage = allowed.length ? average(allowed) : null;
    const h2h = current.filter((row) => row.opponentId === matchup.opponentId && validMetric(row.stats[metric.column], metric.column)).slice(0, 4).map((row) => row.stats[metric.column]);
    const historyAverage = h2h.length >= 2 ? average(h2h) : null;
    const competitive = current.filter((row) => contenderIds.has(row.eventId) && validMetric(row.stats[metric.column], metric.column)).map((row) => row.stats[metric.column]);
    const contenderAverage = competitive.length >= 3 ? average(competitive) : null;
    const fresh = metricRows.length > 0 && cutoff - Date.parse(metricRows[0].date) <= 21 * 86400000;
    const limitedData = !fresh || values.length < 3 || ownSamples.length < 3 || allowed.length < 3;
    const ready = fresh && baseline !== null && baseline >= 0 && defenseAverage !== null && effectiveShare !== null && ownSamples.length > 0;
    const defenseRank = receivingDefenses.find((row) => row.teamId === matchup.opponentId && row.position === player.position)?.rank ?? null;
    const weakReceiving = (player.position === 'WR' || player.position === 'TE') && defenseRank !== null && defenseRank >= 29;
    let estimate: number | null = null;
    let basis: NonNullable<BotProjection['basis']> = 'matchup';
    const scale = unit === 'receptions' ? 10 : 1;
    if (ready) {
      const weight = limitedData ? .15 : .3;
      let value = (1 - weight) * baseline! + weight * defenseAverage! * effectiveShare!;
      if (historyAverage !== null && !limitedData) value = .9 * value + .1 * historyAverage;
      if (contenderAverage !== null && !limitedData) value = .95 * value + .05 * contenderAverage;
      if (weakReceiving) value *= limitedData ? 1.03 : 1.08;
      estimate = Math.round(Math.max(baseline! * (limitedData ? .85 : .75),
        Math.min(baseline! * (limitedData ? 1.15 : weakReceiving ? 1.35 : 1.25), value)) * scale) / scale;
    }
    if (!ready && values.length) {
      basis = 'current-season';
      const roleFactor = share !== null && share > roleCap ? roleCap / share : share === null && role && role.rank > 1
        ? player.position === 'QB' ? .15 : role.rank === 2 ? .65 : .4 : 1;
      estimate = Math.round(Math.max(0, average(values) * roleFactor) * scale) / scale;
      problems.push('Current-season fallback: completed-game average with available role limits. Missing positional matchup/share data is not invented; no prior seasons are used.');
      if (!fresh) problems.push('The latest verified player sample is more than 21 days old. This estimate does not confirm a current workload or availability.');
    }
    if (estimate === null) problems.push('No verified current-season player production exists for this metric. No numeric estimate can be supported; refresh sources to retry.');
    if (limitedData && ready) problems.push('Limited-data estimate: fewer than three player or opponent samples. Matchup adjustments are reduced.');
    const matchupEffect = defenseAverage !== null && effectiveShare !== null && baseline !== null ? defenseAverage * effectiveShare - baseline : 0;
    const direction = matchupEffect > 0 ? 'lifts' : matchupEffect < 0 ? 'tempers' : 'supports';
    return { market: metric.market, label: metric.label, estimate, unit, yards: unit === 'yards' ? estimate : null,
      baseline: baseline === null ? null : round(baseline), playerGames: values.length, role, defenseRank, limitedData, basis,
      defenseAverage: defenseAverage === null ? null : round(defenseAverage), defenseGames: allowed.length, share: share === null ? null : round(share * 100),
      historyAverage: historyAverage === null ? null : round(historyAverage), historyGames: h2h.length,
      contenderAverage: contenderAverage === null ? null : round(contenderAverage), contenderGames: competitive.length,
      context: `${standingsContext} ${bothContenders ? 'Both teams are currently top-two in their divisions. ' : ''}Stakes alone do not create an automatic yardage boost.`,
      explanation: estimate === null ? 'No verified current-season production for this stat. Refresh outlook to retry the sources.'
        : basis === 'current-season' ? `Current-season completed games provide this fallback estimate, with available role limits. Positional matchup adjustments could not be verified.${!fresh ? ' Latest recorded workload is over 21 days old.' : ''}`
        : `The ${player.position} ${unit === 'receptions' ? 'reception' : 'yardage'} matchup against ${matchup.opponent} ${direction} the outlook.`
          + (historyAverage !== null ? ' Past meetings also factor in.' : '')
          + (contenderAverage !== null ? ' Results against contenders add context.' : '')
          + (weakReceiving ? ' Bottom-four positional yardage allowance adds upside.' : ''),
      sourceGames, warnings: [...new Set(problems)] };
  });
}
