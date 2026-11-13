import { array, numeric, object, text } from '../../supabase/functions/_shared/gamewaire';
import type { SimulationAccuracyGame } from '../../supabase/functions/_shared/nflSimulationAccuracy';
import type { SimulationStat } from '../../supabase/functions/_shared/nflSimulation';
import type { Angle } from './theAngle';
import { anglePicks, pickCategory } from './anglePicks';
import type { Game } from './sportsData';

export type RecapGrade = 'hit' | 'miss' | 'push' | 'review';
export type SimulationRecapRow = { title: string; detail: string; grade: RecapGrade; source: 'verified' | 'admin' | 'simulation' | 'review' };
type RecapTeam = { id: string; name: string; abbr: string; score: number; record: string; aliases: string[] };
type RecapPlayer = { id: string; name: string; teamId: string; aliases: string[]; stats: Partial<SimulationStat> };
export type RecapFinal = { eventId: string; kickoff: string; week: number | null; venue: string; home: RecapTeam; away: RecapTeam; players: RecapPlayer[] };
export type SimulationRecapSnapshot = {
  eventId: string; capturedAt: string; kickoff: string; venue: string; home: RecapTeam; away: RecapTeam;
  mode: 'admin' | 'simulation'; rows: SimulationRecapRow[]; analysis: string[]; issues: string[];
};
export type RecapSpread = { teamId: string; line: number; recordedAt: string };
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const validNumber = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const contains = (value: string, alias: string) => alias !== '' && ` ${key(value)} `.includes(` ${key(alias)} `);
const unique = <T>(rows: T[]) => [...new Set(rows)];
const display = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
const signed = (value: number) => value > 0 ? `+${value}` : String(value);
const metricKeys = ['passingAttempts', 'completions', 'passingYards', 'passingTouchdowns', 'rushingAttempts', 'rushingYards',
  'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns'] as const;

export function readRecapFinal(value: unknown, game: Game): RecapFinal {
  const summary = object(value), header = object(summary.header), competitions = array(header.competitions);
  const competition = object(competitions[0]), status = object(object(competition.status).type);
  if (game.league !== 'NFL' || game.status !== 'FINAL' || text(header.id) !== game.eventId || competitions.length !== 1
    || Date.parse(text(competition.date)) !== Date.parse(game.date)
    || status.completed !== true || status.state !== 'post' || status.name !== 'STATUS_FINAL')
    throw new Error('A verified normal NFL final matching this game is required for a recap.');
  const competitors = array(competition.competitors).map(object);
  const team = (side: 'home' | 'away'): RecapTeam => {
    const matches = competitors.filter(row => row.homeAway === side), row = matches[0], identity = object(row?.team);
    const score = numeric(row?.score) ?? numeric(object(row?.score).value);
    if (competitors.length !== 2 || matches.length !== 1 || text(identity.id) !== game[side].id
      || !text(identity.displayName) || !validNumber(score) || !Number.isInteger(score) || score < 0)
      throw new Error('The recap final score or team identity could not be verified.');
    return { id: text(identity.id), name: text(identity.displayName), abbr: text(identity.abbreviation) || game[side].abbr,
      score, record: text(object(array(row.records).find(raw => object(raw).type === 'total')).summary),
      aliases: unique([text(identity.displayName), text(identity.shortDisplayName), text(identity.name), text(identity.abbreviation)].filter(Boolean)) };
  };
  const home = team('home'), away = team('away'), players = new Map<string, RecapPlayer>();
  for (const rawTeam of array(object(summary.boxscore).players)) {
    const row = object(rawTeam), teamId = text(object(row.team).id);
    if (![home.id, away.id].includes(teamId)) continue;
    for (const rawGroup of array(row.statistics)) {
      const group = object(rawGroup), keys = array(group.keys);
      for (const rawPlayer of array(group.athletes)) {
        const row = object(rawPlayer), athlete = object(row.athlete);
        if (row.didNotPlay === true || !text(athlete.id) || !text(athlete.displayName)) continue;
        const id = `${teamId}:${text(athlete.id)}`, values = array(row.stats);
        const player = players.get(id) ?? { id: text(athlete.id), name: text(athlete.displayName), teamId,
          aliases: unique([text(athlete.displayName), text(athlete.fullName), text(athlete.shortName)].filter(Boolean)), stats: {} };
        for (const stat of metricKeys) {
          const index = keys.indexOf(stat);
          if (index < 0) continue;
          const value = numeric(values[index]);
          if (!validNumber(value) || !Number.isInteger(value) || value < 0 && !stat.endsWith('Yards')) continue;
          if (player.stats[stat] !== undefined && player.stats[stat] !== value)
            throw new Error('Conflicting final player statistics require review before exporting a recap.');
          player.stats[stat] = value;
        }
        players.set(id, player);
      }
    }
  }
  const week = numeric(header.week) ?? numeric(object(header.week).number);
  return { eventId: game.eventId, kickoff: game.date, week: validNumber(week) && Number.isInteger(week) && week > 0 ? week : null,
    home, away, players: [...players.values()],
    venue: text(object(object(summary.gameInfo).venue).fullName) || game.venue };
}

function matchedPlayer(subject: string, final: RecapFinal, surnames: boolean) {
  const matches = final.players.filter(player => player.aliases.some(alias => key(alias) === key(subject))
    || surnames && key(player.name.split(' ').at(-1) ?? '') === key(subject));
  return matches.length === 1 ? matches[0] : undefined;
}
const matchedTeam = (subject: string, final: RecapFinal) => {
  const matches = [final.home, final.away].filter(team => team.aliases.some(alias => key(alias) === key(subject)));
  return matches.length === 1 ? matches[0] : undefined;
};
const grade = (margin: number): RecapGrade => margin > 0 ? 'hit' : margin < 0 ? 'miss' : 'push';
const review = (title: string, detail = 'Original wording or final statistic needs manual review.'): SimulationRecapRow =>
  ({ title, detail, grade: 'review', source: 'review' });
const statNames: Record<string, keyof SimulationStat> = {
  'passing yards': 'passingYards', 'pass yards': 'passingYards', 'pass yds': 'passingYards',
  'rushing yards': 'rushingYards', 'rush yards': 'rushingYards', 'rush yds': 'rushingYards',
  'receiving yards': 'receivingYards', 'receiving yds': 'receivingYards', 'rec yards': 'receivingYards', 'rec yds': 'receivingYards',
  receptions: 'receptions', catches: 'receptions', 'passing touchdowns': 'passingTouchdowns', 'pass tds': 'passingTouchdowns',
  'rushing touchdowns': 'rushingTouchdowns', 'rush tds': 'rushingTouchdowns',
  'receiving touchdowns': 'receivingTouchdowns', 'rec tds': 'receivingTouchdowns',
};
export function gradeRecapPick(original: string, final: RecapFinal, surnames = true): SimulationRecapRow {
  const value = original.trim().replace(/\s*(?:\([+-]\d{3,5}\)|@\s*[+-]\d{3,5})\s*$/, '').trim();
  const result = (margin: number, detail: string): SimulationRecapRow => Number.isFinite(margin)
    ? { title: original, detail: `${detail}${margin === 0 ? ' Push.' : ''}`, grade: grade(margin), source: 'verified' }
    : review(original, 'The original line is not a valid finite number; manual review required.');
  const teamBet = value.match(/^(.+?)\s+(ML|moneyline|to win|[+-]\d+(?:\.\d+)?)$/i);
  if (teamBet) {
    const team = matchedTeam(teamBet[1], final);
    if (team) {
      const line = /^[+-]/.test(teamBet[2]) ? Number(teamBet[2]) : 0;
      const opponent = team.id === final.home.id ? final.away : final.home;
      return result(team.score - opponent.score + line, `Final ${team.abbr} ${team.score} - ${opponent.abbr} ${opponent.score}${line ? `; line ${signed(line)}` : ''}.`);
    }
  }
  const td = value.match(/^(.+?)\s+(?:(?:anytime|any time)\s+)?(?:TD|touchdown)(?:\s+scorer)?$/i);
  if (td) {
    const player = matchedPlayer(td[1], final, surnames);
    if (player) {
      const rush = player.stats.rushingTouchdowns, rec = player.stats.receivingTouchdowns;
      const known = (rush ?? 0) + (rec ?? 0);
      if (known > 0) return result(1, `${player.name}: ${known} verified rushing/receiving TD${known === 1 ? '' : 's'}.`);
      if (rush !== undefined && rec !== undefined) return result(-1, `${player.name}: 0 rushing + receiving TDs.`);
      return review(original, 'No scoring TD verified; incomplete rushing/receiving stats cannot be treated as zero.');
    }
  }
  const prop = value.match(/^(.+?)\s+(over|under|o|u)\s*(\d+(?:\.\d+)?)\s+(.+)$/i);
  const threshold = value.match(/^(.+?)\s+(\d+(?:\.\d+)?)\+\s+(.+)$/i);
  if (prop || threshold) {
    const subject = prop?.[1] ?? threshold![1], player = matchedPlayer(subject, final, surnames);
    const label = prop?.[4] ?? threshold![3], stat = statNames[key(label)];
    const line = Number(prop?.[3] ?? threshold![2]);
    if (player && stat && player.stats[stat] !== undefined) {
      const actual = player.stats[stat]!;
      return result(threshold ? actual >= line ? 1 : -1 : (actual - line) * (/^(under|u)$/i.test(prop![2]) ? -1 : 1),
        `${player.name}: final ${actual} ${label.toLowerCase()}; ${threshold ? 'at least' : prop![2].toLowerCase()} ${line}.`);
    }
  }
  const total = value.match(/^(?:(?:game|total|total points)\s+)?(over|under|o|u)\s*(\d+(?:\.\d+)?)(?:\s+(?:points|pts))?$/i);
  if (total) {
    const points = final.home.score + final.away.score;
    return result((points - Number(total[2])) * (/^(under|u)$/i.test(total[1]) ? -1 : 1), `Final game total: ${points} points.`);
  }
  return review(original);
}

export function recapAdminRows(stories: Angle[], game: Game, final: RecapFinal): SimulationRecapRow[] {
  const rows: SimulationRecapRow[] = [], seen = new Set<string>();
  for (const story of stories) {
    if (story.status !== 'published' || story.season !== game.seasonYear
      || ![game.id, 'NFL:0'].includes(story.game_id)) continue;
    if (story.game_id === 'NFL:0' && (final.week === null || story.week !== final.week)) continue;
    const published = Date.parse(story.published_at ?? '');
    if (published >= Date.parse(game.date)) continue;
    for (const pick of anglePicks(story)) {
      const linked = story.game_id === game.id;
      const identifiable = [final.home, final.away].some(team => team.aliases.some(alias => contains(pick.text, alias)))
        || final.players.some(player => player.aliases.some(alias => contains(pick.text, alias)));
      if (!linked && !identifiable) continue;
      const id = `${story.id}:${pick.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!Number.isFinite(published)) { rows.push(review(pick.text, 'Pregame publication time could not be verified.')); continue; }
      let row: SimulationRecapRow;
      if (pickCategory(pick) === 'parlay') {
        const legs = pick.text.replace(/^parlay\s*:?\s*/i, '').split(/\n|;|\s+\+\s+|\s+&\s+/).map(leg => leg.trim()).filter(Boolean);
        const graded = legs.map(leg => gradeRecapPick(leg, final, linked));
        row = legs.length < 2 || graded.some(leg => leg.grade === 'review' || leg.grade === 'push')
          ? review(pick.text, 'Full-ticket verification required; cross-game or pushed parlay legs are not inferred.')
          : { title: pick.text, detail: `${legs.length} game-matched legs checked against the final box score.`,
            grade: graded.some(leg => leg.grade === 'miss') ? 'miss' : 'hit', source: 'verified' };
      } else row = gradeRecapPick(pick.text, final, linked);
      if (row.grade === 'review' && pick.result !== 'pending') row = { ...row, grade: pick.result,
        source: 'admin', detail: 'Admin-graded result; original wording could not be independently auto-graded.' };
      rows.push(row);
    }
  }
  return rows;
}

function simulationHighlights(saved: SimulationAccuracyGame, final: RecapFinal, spreads: RecapSpread[]): SimulationRecapRow[] {
  if (saved.eventId !== final.eventId || Date.parse(saved.kickoff) !== Date.parse(final.kickoff)
    || !(Date.parse(saved.forecastAt) < Date.parse(final.kickoff))
    || saved.home.id !== final.home.id || saved.away.id !== final.away.id
    || saved.home.actual !== final.home.score || saved.away.actual !== final.away.score
    || ![saved.home.projected, saved.away.projected].every(Number.isFinite))
    throw new Error('The saved pregame simulation comparison does not match this verified final.');
  const rows: SimulationRecapRow[] = [], groups = new Map<string, typeof saved.players>();
  const add = (title: string, detail: string) => rows.push({ title, detail, grade: 'hit', source: 'simulation' });
  for (const player of saved.players) {
    if (![player.actual, player.projected].every(Number.isFinite)) continue;
    const id = `${player.team}:${player.playerId}`, group = groups.get(id) ?? [];
    group.push(player); groups.set(id, group);
  }
  for (const group of groups.values()) {
    const rush = group.find(row => row.stat === 'rushingTouchdowns'), rec = group.find(row => row.stat === 'receivingTouchdowns');
    if (rush && rec && rush.projected + rec.projected >= .5 && rush.actual + rec.actual >= 1)
      add(`${group[0].name} TD`, `Saved sim ${display(rush.projected + rec.projected)} rush + rec TD; final ${rush.actual + rec.actual}.`);
  }
  for (const spread of spreads) {
    if (!Number.isFinite(spread.line) || !(Date.parse(spread.recordedAt) < Date.parse(final.kickoff))) continue;
    const team = spread.teamId === final.home.id ? saved.home : spread.teamId === final.away.id ? saved.away : undefined;
    const opponent = team?.id === saved.home.id ? saved.away : saved.home;
    if (team && team.projected - opponent.projected + spread.line > 0 && team.actual - opponent.actual + spread.line > 0) {
      add(`${team.abbr} ${signed(spread.line)}`, `Saved pregame line; sim and final both cover ${signed(spread.line)}.`);
      break;
    }
  }
  const minimums: Partial<Record<keyof SimulationStat, number>> = { passingYards: 200, rushingYards: 30, receivingYards: 30, receptions: 3 };
  const labels: Partial<Record<keyof SimulationStat, string>> = { passingYards: 'passing yards', rushingYards: 'rushing yards', receivingYards: 'receiving yards', receptions: 'receptions' };
  const close = saved.players.filter(row => minimums[row.stat] !== undefined && Number.isFinite(row.projected) && Number.isFinite(row.actual)
    && row.projected >= minimums[row.stat]! && row.actual >= minimums[row.stat]!
    && Math.abs(row.actual - row.projected) / row.actual <= .1)
    .sort((a, b) => a.error - b.error || a.playerId.localeCompare(b.playerId));
  for (const player of close) {
    if (rows.length >= 5) break;
    add(`${player.name} ${labels[player.stat]}`, `Sim ${display(player.projected)}; final ${player.actual}. Within 10%, not an exact-stat hit.`);
  }
  if (!rows.length) rows.push(review('No qualifying simulation highlights', 'No verified TD, covered saved line or supported stat within 10% qualified.'));
  return rows.slice(0, 5);
}

export function simulationRecapSnapshot(game: Game, summary: unknown, stories: Angle[], saved?: SimulationAccuracyGame,
  spreads: RecapSpread[] = [], now = Date.now()): SimulationRecapSnapshot {
  const final = readRecapFinal(summary, game), admin = recapAdminRows(stories, game, final);
  if (!Number.isFinite(now) || now < Date.parse(game.date)) throw new Error('A valid postgame capture time is required.');
  if (!admin.length && !saved) throw new Error('No pregame admin picks or verified saved simulation comparison are available for this game yet.');
  const mode = admin.length ? 'admin' : 'simulation', rows = admin.length ? admin : simulationHighlights(saved!, final, spreads);
  const count = (grade: RecapGrade) => rows.filter(row => row.grade === grade).length;
  const graded = count('hit') + count('miss'), manual = rows.filter(row => row.source === 'admin').length;
  const analysis = mode === 'admin'
    ? [`Analyst Desk: ${count('hit')} hit, ${count('miss')} missed, ${count('push')} pushed; ${count('review')} need review. ${graded} win/loss results shown.`,
      `${manual ? `${manual} result${manual === 1 ? '' : 's'} use explicit admin grading. ` : ''}Verified grades use the final box score and original pick wording. Pushes and unverified picks are not counted as wins.`]
    : ['No pregame Analyst Desk picks were matched to this game. These are selected saved-simulation highlights, not a betting record.',
      `Saved score: ${saved!.away.abbr} ${Math.round(saved!.away.projected)} - ${saved!.home.abbr} ${Math.round(saved!.home.projected)}. All player comparisons use verified, comparable statistics; missing data is not treated as zero.`];
  return { eventId: game.eventId, capturedAt: new Date(now).toISOString(), kickoff: game.date, venue: final.venue,
    home: { ...final.home }, away: { ...final.away }, mode, rows: rows.map(row => ({ ...row })), analysis,
    issues: mode === 'simulation' ? [...saved!.issues] : [] };
}
