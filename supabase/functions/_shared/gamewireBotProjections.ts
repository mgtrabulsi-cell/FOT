import { array, numeric, object, text } from './gamewaire.ts';
import { botLogRows } from './gamewireBot.ts';
import type { BotDirectory, BotMatchup, BotPlayer } from './gamewireBot.ts';

export type BotProjection = {
  market: string; label: string; yards: number | null; baseline: number | null; playerGames: number;
  defenseAverage: number | null; defenseGames: number; share: number | null;
  historyAverage: number | null; historyGames: number; contenderAverage: number | null; contenderGames: number;
  context: string; explanation: string; warnings: string[];
  sourceGames: Array<{ id: string; date: string; role: 'team' | 'opponent' }>;
};
type ScheduledGame = { id: string; date: string; opponentId: string; pointsFor: number; pointsAgainst: number };
type Schedule = { games: ScheduledGame[]; standing: string };
const site = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Math.round(value * 10) / 10;
const metrics: Record<string, Array<{ market: string; label: string; category: string; column: string }>> = {
  QB: [{ market: 'player_pass_yds', label: 'Passing yards', category: 'passing', column: 'passingYards' }, { market: 'player_rush_yds', label: 'Rushing yards', category: 'rushing', column: 'rushingYards' }],
  RB: [{ market: 'player_rush_yds', label: 'Rushing yards', category: 'rushing', column: 'rushingYards' }, { market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }],
  WR: [{ market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }],
  TE: [{ market: 'player_reception_yds', label: 'Receiving yards', category: 'receiving', column: 'receivingYards' }],
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
export function positionGameYards(value: unknown, eventId: string, offenseId: string, season: number, position: string,
  category: string, column: string, positions: Record<string, string>, playerId?: string) {
  const data = object(value), header = object(data.header), competition = object(array(header.competitions)[0]);
  if (text(header.id) !== eventId || numeric(object(header.season).year) !== season || numeric(object(header.season).type) !== 2
    || object(object(competition.status).type).completed !== true) throw new Error('A box score did not confirm the requested completed regular-season game.');
  const offense = array(object(data.boxscore).players).map(object).find((row) => text(object(row.team).id) === offenseId);
  const stats = array(offense?.statistics).map(object).find((row) => row.name === category), index = array(stats?.keys).indexOf(column);
  if (!stats || index < 0 || !array(stats.athletes).length) throw new Error(`The box score does not report ${category} yardage.`);
  let total = 0, player: number | null = null, classified = false;
  for (const raw of array(stats.athletes)) {
    const row = object(raw), athlete = object(row.athlete), id = text(athlete.id), yards = numeric(array(row.stats)[index]);
    if (yards === undefined) throw new Error('A listed player has missing yardage in the box score.');
    const rawPosition = text(object(athlete.position).abbreviation) || positions[id], role = rawPosition === 'FB' || rawPosition === 'HB' ? 'RB' : rawPosition;
    if (!role && yards !== 0) throw new Error('A player position could not be verified for the defensive sample.');
    if (role === position) { total += yards; classified = true; if (id === playerId) player = yards; }
  }
  if (!classified) throw new Error(`No verified ${position} position group was reported for this sample.`);
  return { total, player };
}
export function yardageEstimate(baseline: number, defenseAverage: number, share: number, history?: number, contenders?: number) {
  if (![baseline, defenseAverage, share].every(Number.isFinite) || baseline <= 0 || defenseAverage < 0 || share < 0 || share > 1)
    throw new Error('Yardage estimates require positive verified production and a valid position share.');
  if ([history, contenders].some((value) => value !== undefined && !Number.isFinite(value))) throw new Error('Historical yardage components must be finite.');
  let estimate = .7 * baseline + .3 * defenseAverage * share;
  if (history !== undefined) estimate = .9 * estimate + .1 * history;
  if (contenders !== undefined) estimate = .95 * estimate + .05 * contenders;
  return Math.round(Math.max(baseline * .75, Math.min(baseline * 1.25, estimate)));
}
async function settled<T>(work: Array<() => Promise<T>>, concurrency = 6) {
  const values: Array<PromiseSettledResult<T>> = [];
  for (let start = 0; start < work.length; start += concurrency) values.push(...await Promise.allSettled(work.slice(start, start + concurrency).map((load) => load())));
  return values;
}
const message = (value: unknown) => value instanceof Error ? value.message : 'Verified source unavailable.';
export async function collectBotProjections(player: BotPlayer, matchup: BotMatchup | null, season: number, currentLogs: unknown,
  directory: BotDirectory, get: (url: string) => Promise<unknown>, now: number): Promise<BotProjection[]> {
  if (!matchup || matchup.state !== 'pre' || Date.parse(matchup.start) <= now) return [];
  const cutoff = Math.min(now, Date.parse(matchup.start)), warnings: string[] = [];
  const loadSchedule = async (id: string) => projectionSchedule(await get(`${site}/teams/${id}/schedule?season=${season}&seasontype=2`), id, season, cutoff);
  const [scheduleResults, historyResults] = await Promise.all([
    Promise.allSettled([loadSchedule(player.teamId), loadSchedule(matchup.opponentId)]),
    Promise.allSettled([1, 2].map((offset) => get(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.id}/gamelog?season=${season - offset}`))),
  ]);
  const [ownResult, defenseResult] = scheduleResults;
  const own = ownResult.status === 'fulfilled' ? ownResult.value : null;
  const defense = defenseResult.status === 'fulfilled' ? defenseResult.value : null;
  if (!own) warnings.push(`Team schedule unavailable: ${ownResult.status === 'rejected' ? message(ownResult.reason) : 'Unverified schedule.'}`);
  if (!defense) warnings.push(`Opponent schedule unavailable: ${defenseResult.status === 'rejected' ? message(defenseResult.reason) : 'Unverified schedule.'}`);
  const current = currentLogs === null ? [] : botLogRows(currentLogs, cutoff, season);
  const historical = [...current];
  historyResults.forEach((result, index) => {
    if (result.status === 'rejected') { warnings.push(`${season - index - 1} head-to-head history unavailable: ${message(result.reason)}`); return; }
    try { historical.push(...botLogRows(result.value, cutoff, season - index - 1)); }
    catch (cause) { console.error('Bot historical log validation failed', player.id, cause); warnings.push(`${season - index - 1} history could not be verified: ${message(cause)}`); }
  });
  const ownGames = own?.games.slice(0, 5) ?? [], defenseGames = defense?.games.slice(0, 5) ?? [];
  const games = [...new Map([...ownGames, ...defenseGames].map((game) => [game.id, game])).values()];
  const boxes = new Map<string, unknown>();
  const boxResults = await settled(games.map((game) => async () => ({ id: game.id, data: await get(`${site}/summary?event=${game.id}`) })));
  boxResults.forEach((result) => {
    if (result.status === 'fulfilled') boxes.set(result.value.id, result.value.data);
    else { console.error('Bot position box score unavailable', result.reason); warnings.push(`A recent position-game sample is unavailable: ${message(result.reason)}`); }
  });
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
    const metricRows = current.filter((row) => row.stats[metric.column] !== undefined);
    const values = metricRows.map((row) => row.stats[metric.column]);
    const baseline = values.length >= 3 ? .65 * average(values.slice(0, 3)) + .35 * average(values) : null;
    const problems = [...warnings], ownSamples: Array<{ total: number; player: number }> = [], allowed: number[] = [], sourceGames: BotProjection['sourceGames'] = [];
    for (const [type, source] of [['own', ownGames], ['defense', defenseGames]] as const) for (const game of source) {
      const box = boxes.get(game.id); if (!box) continue;
      try {
        const yards = positionGameYards(box, game.id, type === 'own' ? player.teamId : game.opponentId, season, player.position, metric.category, metric.column, directory.positions, player.id);
        if (type === 'defense') { allowed.push(yards.total); sourceGames.push({ id: game.id, date: game.date, role: 'opponent' }); }
        else if (yards.player !== null) { ownSamples.push({ total: yards.total, player: yards.player }); sourceGames.push({ id: game.id, date: game.date, role: 'team' }); }
      } catch (cause) { problems.push(`${game.id} ${metric.label} sample excluded: ${message(cause)}`); }
    }
    const total = ownSamples.reduce((sum, row) => sum + row.total, 0);
    const rawShare = total > 0 ? ownSamples.reduce((sum, row) => sum + row.player, 0) / total : null;
    const share = rawShare !== null && rawShare >= 0 && rawShare <= 1 ? rawShare : null;
    const defenseAverage = allowed.length >= 3 ? average(allowed) : null;
    const h2h = historical.filter((row) => row.opponentId === matchup.opponentId && row.stats[metric.column] !== undefined).slice(0, 4).map((row) => row.stats[metric.column]);
    const historyAverage = h2h.length >= 2 ? average(h2h) : null;
    const competitive = current.filter((row) => contenderIds.has(row.eventId) && row.stats[metric.column] !== undefined).map((row) => row.stats[metric.column]);
    const contenderAverage = competitive.length >= 3 ? average(competitive) : null;
    const fresh = metricRows.length > 0 && cutoff - Date.parse(metricRows[0].date) <= 21 * 86400000;
    const ready = fresh && baseline !== null && baseline > 0 && defenseAverage !== null && share !== null && ownSamples.length >= 3;
    const yards = ready ? yardageEstimate(baseline!, defenseAverage!, share!, historyAverage ?? undefined, contenderAverage ?? undefined) : null;
    if (!ready) problems.push('A matchup-adjusted estimate needs three recent verified player/position-share games, three opponent position-game samples, and positive player production. No missing samples are filled in.');
    const direction = yards !== null && baseline !== null ? yards > baseline ? 'higher' : yards < baseline ? 'lower' : 'close to the baseline' : '';
    return { market: metric.market, label: metric.label, yards, baseline: baseline === null ? null : round(baseline), playerGames: values.length,
      defenseAverage: defenseAverage === null ? null : round(defenseAverage), defenseGames: allowed.length, share: share === null ? null : round(share * 100),
      historyAverage: historyAverage === null ? null : round(historyAverage), historyGames: h2h.length,
      contenderAverage: contenderAverage === null ? null : round(contenderAverage), contenderGames: competitive.length,
      context: `${standingsContext} ${bothContenders ? 'Both teams are currently top-two in their divisions. ' : ''}Stakes alone do not create an automatic yardage boost.`,
      explanation: yards === null ? 'No defensible matchup-adjusted estimate is available from the verified samples.'
        : `${matchup.opponent}'s recent ${player.position} yardage allowance and ${player.name}'s measured share of their team's ${player.position} production move this estimate ${direction}. The defensive figure is a position-group total per team-game, not yards expected for one player.`
          + (historyAverage !== null ? ` Direct opponent history adds a small adjustment from ${h2h.length} verified meetings.` : ' Fewer than two verified direct meetings: no head-to-head adjustment.')
          + (contenderAverage !== null ? ` A small contender-game adjustment uses ${competitive.length} games where both teams were at least .600 before kickoff, with four prior games each.` : ' No sufficiently large verified contender-game split: no big-game adjustment.'),
      sourceGames, warnings: [...new Set(problems)] };
  });
}
