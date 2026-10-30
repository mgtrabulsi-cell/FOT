import { array, normalize, numeric, object, text } from './gamewaire.ts';
import type { BotProjection } from './gamewireBotProjections.ts';

export type BotFormat = 'ppr' | 'half' | 'standard';
export type BotPlayer = { id: string; name: string; position: 'QB' | 'RB' | 'WR' | 'TE'; teamId: string; team: string; teamAbbr: string };
export type BotWeek = { season: number; week: number; seasonType: number };
export type BotDirectory = BotWeek & { players: BotPlayer[]; positions: Record<string, string>; warnings: string[]; checkedAt: string };
export type BotMatchup = { eventId: string; start: string; opponentId: string; opponent: string; home: boolean; state: 'pre' | 'in' | 'post' };
export type BotStat = { label: string; average: number; games: number };
export type BotProp = { selection: string; american: number; book: string; savedAt: string; breakdown: string };
export type BotEditorial = {
  graphics: Array<{ id: string; kind: 'start' | 'sit'; reason: string; updatedAt: string }>;
  ranking: { rank: number; position: string; format: BotFormat; publishedAt: string } | null;
};
export type BotReport = {
  player: BotPlayer; season: number; week: number; format: BotFormat; checkedAt: string;
  indication: 'Must Start' | 'Start' | 'Flex' | 'Sit' | 'Must Sit' | 'Monitor' | 'No upcoming game' | 'Game locked';
  summary: string; workload: BotStat[]; production: BotStat[]; fantasyAverage: number | null;
  matchup: BotMatchup | null; matchupText: string; availability: string; warnings: string[];
  props: BotProp[]; propNote: string;
  eligibleForGuidance: boolean; editorial: BotEditorial;
  dataIssues: string[];
  projections: BotProjection[];
};
const positions = ['QB', 'RB', 'WR', 'TE'] as const;
export function readBotWeek(value: unknown): BotWeek {
  const data = object(value), season = numeric(object(data.season).year), week = numeric(object(data.week).number), seasonType = numeric(object(data.season).type);
  if (!season || !week || ![1, 2, 3].includes(seasonType ?? 0) || season < 2000 || week < 1 || week > 22)
    throw new Error('ESPN did not provide a valid current NFL season/week. Retry the bot.');
  return { season, week, seasonType: seasonType! };
}
export function readBotRoster(value: unknown, team: { id: string; name: string; abbr: string }): BotPlayer[] {
  const data = object(value);
  if (!Array.isArray(data.athletes)) throw new Error(`${team.abbr}: ESPN returned an invalid roster.`);
  return data.athletes.flatMap((entry) => Array.isArray(object(entry).items) ? array(object(entry).items) : [entry]).flatMap((raw) => {
    const row = object(raw), position = positions.find((position) => position === text(object(row.position).abbreviation));
    const id = text(row.id), name = text(row.displayName);
    return position && /^\d{1,12}$/.test(id) && name ? [{ id, name, position, teamId: team.id, team: team.name, teamAbbr: team.abbr }] : [];
  });
}
export function botMatchup(value: unknown, player: BotPlayer): BotMatchup | null {
  const matches = array(object(value).events).flatMap((raw) => {
    const event = object(raw), competition = object(array(event.competitions)[0]), sides = array(competition.competitors).map(object);
    const own = sides.find((row) => text(object(row.team).id) === player.teamId);
    if (!own) return [];
    const opponent = sides.find((row) => row !== own), state = text(object(object(competition.status).type).state);
    const start = text(event.date), eventId = text(event.id), other = object(opponent?.team);
    if (!/^\d+$/.test(eventId) || !Number.isFinite(Date.parse(start)) || !['pre', 'in', 'post'].includes(state)
      || !text(other.id) || !text(other.displayName)) throw new Error('ESPN returned incomplete weekly matchup information.');
    return [{ eventId, start, opponentId: text(other.id), opponent: text(other.displayName), home: own.homeAway === 'home', state: state as BotMatchup['state'] }];
  });
  if (matches.length > 1) throw new Error('More than one game matched this player in the selected NFL week.');
  return matches[0] ?? null;
}
export function readBotPositions(value: unknown): Record<string, string> {
  const data = object(value);
  if (!Array.isArray(data.athletes)) throw new Error('ESPN returned an invalid position directory.');
  return Object.fromEntries(data.athletes.flatMap((entry) => Array.isArray(object(entry).items) ? array(object(entry).items) : [entry]).flatMap((raw) => {
    const row = object(raw), id = text(row.id), position = text(object(row.position).abbreviation);
    return /^\d{1,12}$/.test(id) && position ? [[id, position]] : [];
  }));
}
type LogRow = { eventId: string; date: string; opponentId: string; stats: Record<string, number> };
export function botLogRows(value: unknown, now: number, season?: number): LogRow[] {
  const data = object(value), names = array(data.names).map(text), events = object(data.events);
  if (!Array.isArray(data.names) || !Array.isArray(data.seasonTypes) || !data.events) throw new Error('Verified player game logs are unavailable.');
  const rows = new Map<string, LogRow>();
  for (const rawType of data.seasonTypes) {
    const type = object(rawType);
    if (numeric(type.type) !== 2 && !/regular season/i.test(text(type.displayName))) continue;
    if (season && !new RegExp(`\\b${season}\\b`).test(text(type.displayName))) throw new Error('Player logs did not confirm the requested NFL season.');
    for (const category of array(type.categories)) for (const raw of array(object(category).events)) {
      const entry = object(raw), eventId = text(entry.eventId), event = object(events[eventId]), date = text(event.gameDate);
      if (!eventId || !Number.isFinite(Date.parse(date)) || Date.parse(date) >= now) continue;
      const values = array(entry.stats), stats: Record<string, number> = {};
      names.forEach((name, index) => {
        const value = numeric(values[index]);
        if (value !== undefined) stats[name] = value;
      });
      rows.set(eventId, { eventId, date, opponentId: text(object(event.opponent).id), stats });
    }
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
export function buildBotReport(player: BotPlayer, roster: unknown, logs: unknown, board: unknown, format: BotFormat, now: number): BotReport {
  const week = readBotWeek(board), matchup = botMatchup(board, player);
  const rawPlayers = array(object(roster).athletes).flatMap((entry) => Array.isArray(object(entry).items) ? array(object(entry).items) : [entry]).map(object);
  const athlete = rawPlayers.find((row) => text(row.id) === player.id && normalize(text(row.displayName)) === normalize(player.name));
  if (roster !== null && (!athlete || text(object(athlete.position).abbreviation) !== player.position)) throw new Error('This player no longer matches the current team roster. Search again.');
  const injuries = array(athlete?.injuries).map(object);
  const status = object(athlete?.status);
  const active = status.type === 'active' || status.name === 'Active' || status.id === '1';
  const availability = [text(status.name) || 'Roster status unreported', ...injuries.map((row) => text(row.status) || 'Injury listed')].join(' / ');
  const uncertain = !active || injuries.some((row) => !/^(active|healthy)$/i.test(text(row.status)));
  const rows = (logs === null ? [] : botLogRows(logs, now, week.season)).filter((row) => !matchup || Date.parse(row.date) < Date.parse(matchup.start)).slice(0, 3);
  const average = (name: string) => rows.length && rows.every((row) => row.stats[name] !== undefined)
    ? rows.reduce((sum, row) => sum + row.stats[name], 0) / rows.length : null;
  const usage: Array<[string, string]> = player.position === 'QB' ? [['passingAttempts', 'Pass attempts']]
    : player.position === 'RB' ? [['rushingAttempts', 'Carries'], ['receivingTargets', 'Targets'], ['receptions', 'Catches']]
    : [['receivingTargets', 'Targets'], ['receptions', 'Catches']];
  const workload = usage.flatMap(([key, label]) => { const value = average(key); return value === null ? [] : [{ label, average: value, games: rows.length }]; });
  const production = (player.position === 'QB' ? [['passingYards', 'Passing yards'], ['rushingYards', 'Rushing yards']]
    : player.position === 'RB' ? [['rushingYards', 'Rushing yards'], ['receivingYards', 'Receiving yards']]
    : [['receivingYards', 'Receiving yards']]).flatMap(([key, label]) => {
    const value = average(key); return value === null ? [] : [{ label, average: value, games: rows.length }];
  });
  const points = rows.map((row) => {
    const s = row.stats, receptionPoints = format === 'ppr' ? 1 : format === 'half' ? .5 : 0;
    const required = player.position === 'QB' ? ['passingYards', 'passingTouchdowns', 'interceptions', 'rushingYards', 'rushingTouchdowns', 'fumblesLost']
      : ['rushingYards', 'rushingTouchdowns', 'receivingYards', 'receivingTouchdowns', 'receptions', 'fumblesLost'];
    if (!required.every((key) => s[key] !== undefined)) return null;
    return (s.passingYards ?? 0) * .04 + (s.passingTouchdowns ?? 0) * 4 - (s.interceptions ?? 0) * 2
      + (s.rushingYards + (s.receivingYards ?? 0)) * .1 + (s.rushingTouchdowns + (s.receivingTouchdowns ?? 0)) * 6
      + (s.receptions ?? 0) * receptionPoints - s.fumblesLost * 2;
  });
  const fantasyAverage = points.length && points.every((point) => point !== null) ? points.reduce<number>((sum, point) => sum + point!, 0) / points.length : null;
  const volume = player.position === 'QB' ? average('passingAttempts') : player.position === 'RB'
    ? average('rushingAttempts') !== null && average('receptions') !== null ? average('rushingAttempts')! + average('receptions')! : null
    : average('receivingTargets');
  const thresholds = player.position === 'QB' ? [25, 20] : player.position === 'RB' ? [15, 8] : player.position === 'WR'
    ? [format === 'standard' ? 8 : 7, 4] : [format === 'standard' ? 6 : 5, 3];
  const label = player.position === 'QB' ? 'pass attempts' : player.position === 'RB' ? 'touches (carries + catches)' : 'targets';
  let indication: BotReport['indication'] = 'Monitor';
  let summary = 'There is not enough recent verified workload to give a Start/Sit indication.';
  if (rows.length >= 3 && now - Date.parse(rows[0].date) <= 21 * 86400000 && volume !== null) {
    indication = volume >= thresholds[0] ? 'Start' : volume >= thresholds[1] && player.position !== 'QB' ? 'Flex' : 'Sit';
    summary = `${player.name} averaged ${volume.toFixed(1)} ${label} over the last ${rows.length} recorded regular-season appearances. ${indication === 'Start'
      ? 'That volume supports a Start outlook' : indication === 'Flex'
        ? 'That workload puts them in the flex conversation rather than making them an automatic start'
        : 'That limited workload makes them a less attractive starting option'} for ${format === 'half' ? 'half-PPR' : format === 'ppr' ? 'PPR' : 'standard'} leagues.`;
  }
  if (uncertain) { indication = 'Monitor'; summary = `${availability}. Availability needs confirming before making a lineup decision; recent usage does not establish that the player will be active.`; }
  if (!matchup) { indication = 'No upcoming game'; summary = 'No game appears for this team on the current NFL week scoreboard. Do not treat this as a confirmed bye without checking the schedule.'; }
  else if (matchup.state !== 'pre' || Date.parse(matchup.start) <= now) {
    indication = 'Game locked'; summary = 'This week’s game has started or finished. This is a historical workload view, not a pregame lineup or betting recommendation.';
  }
  if (week.seasonType !== 2) { indication = 'Monitor'; summary = 'This preview supports regular-season weekly outlooks only. Preseason and postseason lineup indications are unavailable.'; }
  return { player, season: week.season, week: week.week, format, checkedAt: new Date(now).toISOString(), indication, summary, workload, production,
    fantasyAverage, matchup, matchupText: 'Opponent matchup statistics are unavailable until verified.',
    availability, warnings: [
      'Owner preview: rules-based verified-data breakdown, not conversational AI or a fantasy projection.',
      'Start/Sit is a workload-only guide, not a lineup ranking. League size, alternatives, injuries and scoring rules can change the decision.',
      'Usage does not confirm a starting role. Roster availability is not a final game-day injury report.',
      ...(rows.length < 3 ? ['Fewer than three recorded current-season appearances are available. No missing stats are assumed to be zero.'] : []),
    ], props: [], propNote: 'No matching published GamewAIre player props for this week. No live odds were requested.',
    eligibleForGuidance: week.seasonType === 2 && !!matchup && matchup.state === 'pre' && Date.parse(matchup.start) > now && !uncertain,
    editorial: { graphics: [], ranking: null },
    dataIssues: [...(roster === null ? ['Current roster availability could not be verified.'] : []), ...(logs === null ? ['Recent player game logs could not be verified. Workload and scoring are unavailable.'] : [])],
    projections: [] };
}

export function applyBotEditorial(report: BotReport, graphicRows: unknown, rankingRows: unknown): BotReport {
  const graphics: BotEditorial['graphics'] = [];
  for (const raw of array(graphicRows)) {
    const row = object(raw), content = object(row.published_content);
    if (content.position !== report.player.position) continue;
    for (const rawSlot of array(content.slots)) {
      const slot = object(rawSlot), player = object(slot.player);
      if (player.id !== report.player.id || player.teamId !== report.player.teamId || normalize(text(player.name)) !== normalize(report.player.name)) continue;
      if (!['start', 'sit'].includes(text(content.kind)) || !text(slot.reason).trim() || !text(row.id) || !Number.isFinite(Date.parse(text(row.updated_at))))
        throw new Error('The published weekly Start/Sit graphic has incomplete guidance.');
      graphics.push({ id: text(row.id), kind: content.kind as 'start' | 'sit', reason: text(slot.reason), updatedAt: text(row.updated_at) });
    }
  }
  const rankings = array(rankingRows).map(object).filter((row) => row.player_id === report.player.id && row.team_id === report.player.teamId
    && normalize(text(row.player_name)) === normalize(report.player.name) && row.position === report.player.position && row.scoring_format === report.format);
  if (rankings.length > 1) throw new Error('More than one weekly ranking matched this player.');
  const row = rankings[0], rank = numeric(row?.rank);
  if (row && (!Number.isInteger(rank) || !rank || rank < 1 || rank > 30 || !Number.isFinite(Date.parse(text(row.published_at)))))
    throw new Error('The published weekly player ranking is invalid.');
  const ranking: BotEditorial['ranking'] = row ? { rank: rank!, position: report.player.position, format: report.format, publishedAt: text(row.published_at) } : null;
  const next = { ...report, editorial: { graphics, ranking }, warnings: [...report.warnings] };
  if (!report.eligibleForGuidance) return next;
  if (ranking) {
    const factor = 1.05 - (ranking.rank - 1) * .1 / 29;
    next.projections = report.projections.map((projection) => {
      if (projection.estimate === null) return projection;
      const scale = projection.unit === 'receptions' ? 10 : 1;
      const estimate = Math.round(projection.estimate * factor * scale) / scale;
      return { ...projection, estimate, yards: projection.unit === 'yards' ? estimate : null,
        explanation: `${projection.explanation} Weekly GameWire ranking also factors in.` };
    });
    next.warnings.push('Published weekly rankings add an editorial adjustment of up to +/-5% to available estimates; rankings do not supply missing production or establish a depth-chart role.');
  }
  const rankText = ranking ? `GameWire's Week ${report.week} ${report.format === 'ppr' ? 'PPR' : report.format === 'half' ? 'half-PPR' : 'standard'} list ranks ${report.player.name} ${ranking.position}${ranking.rank}.` : '';
  if (new Set(graphics.map((row) => row.kind)).size > 1) {
    next.indication = 'Monitor';
    next.summary = `This week's published graphics include both Start and Sit guidance for ${report.player.name}. Review both before choosing a lineup. ${rankText}`.trim();
    return next;
  }
  if (graphics.length) {
    const kind = graphics[0].kind;
    next.indication = kind === 'start' ? 'Must Start' : 'Must Sit';
    next.summary = `GameWire's Week ${report.week} published graphic identifies ${report.player.name} as a ${kind === 'start' ? 'Must Start' : 'Must Sit'}. ${graphics[0].reason} ${rankText} Workload context: ${report.summary}`.trim();
    next.warnings.push('Published Start/Sit graphics are editorial guidance with no specified scoring format; the ranking, when present, matches your selected format.');
  } else if (ranking) {
    const starterBand = report.player.position === 'QB' || report.player.position === 'TE' ? 12 : 24;
    if (report.indication === 'Start') next.indication = ranking.rank <= starterBand ? 'Must Start' : report.player.position === 'RB' || report.player.position === 'WR' ? 'Flex' : 'Monitor';
    if (report.indication === 'Sit' && ranking.rank <= starterBand) next.indication = 'Monitor';
    next.summary = `${rankText} ${report.summary} ${next.indication === 'Must Start' ? 'The published ranking and verified workload align with GameWire’s Must Start verdict.' : next.indication !== report.indication
      ? 'The ranking and workload point in different directions, so this is not an automatic start.' : 'The indication considers this ranking alongside the recorded workload, rather than treating every top-30 player as a starter.'}`;
    next.warnings.push('Ranking context uses QB/TE top 12 and RB/WR top 24 as a typical 12-team starting band, not a universal lineup rule.');
  }
  return next;
}
