type RecordValue = Record<string, unknown>;
export const nbaRecord = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function count(value: unknown): number | undefined {
  if (value === null || value === undefined || text(value).trim() === '') return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
function seconds(value: unknown): number | undefined {
  const clock = text(value).trim();
  if (!/^(?:\d+:)?\d+(?:\.\d+)?$/.test(clock)) return undefined;
  const parts = clock.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}
type Side = { id: string; abbreviation: string; score: number; lines: Array<number | undefined> };
type Player = { id: string; name: string; points: number; rebounds?: number; assists?: number };
type Shot = { id: string; playerId: string; teamId: string; period: number; clock: number; value: number; away: number; home: number; sequence: number };
export type NBAGame = {
  id: string; date: string; status: 'pre' | 'in' | 'post'; statusName: string; period: number; clock?: number;
  away: Side; home: Side; players: Player[]; shots: Shot[]; completeBox: boolean;
};
export type NBAAlertState = {
  status: string; trackedLive: boolean; completedPeriod: number; points: Record<string, number>; finalPlayers: string[]; buzzers: string[];
};
export type NBAAlert = {
  key: string; kind: 'quarter' | 'milestone' | 'final-player' | 'buzzer'; body: string; teamIds: string[];
};

export function nbaDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function parseNBAPushGame(rawEvent: unknown, rawSummary: unknown): NBAGame {
  const event = nbaRecord(rawEvent), summary = nbaRecord(rawSummary);
  const board = nbaRecord(list(event.competitions)[0]);
  const header = nbaRecord(list(nbaRecord(summary.header).competitions)[0]);
  const status = { ...nbaRecord(board.status ?? event.status), ...nbaRecord(header.status) };
  const statusType = nbaRecord(status.type);
  const state = text(statusType.state);
  if (!['pre', 'in', 'post'].includes(state) || !text(event.id) || !Number.isFinite(Date.parse(text(event.date)))) throw new Error('Invalid NBA event identity or status.');
  function side(homeAway: string): Side {
    const boardSide = list(board.competitors).map(nbaRecord).find((entry) => entry.homeAway === homeAway);
    const summarySide = list(header.competitors).map(nbaRecord).find((entry) => entry.homeAway === homeAway);
    if (!boardSide && !summarySide) throw new Error(`Missing NBA ${homeAway} team.`);
    const competitor: RecordValue = { ...boardSide, ...summarySide, team: { ...nbaRecord(boardSide?.team), ...nbaRecord(summarySide?.team) } };
    const team = nbaRecord(competitor.team), score = count(competitor.score);
    if (!text(team.id) || !text(team.abbreviation) || score === undefined) throw new Error(`Invalid NBA ${homeAway} score.`);
    return { id: text(team.id), abbreviation: text(team.abbreviation), score, lines: list(competitor.linescores).map((line) => count(nbaRecord(line).value)) };
  }
  const away = side('away'), home = side('home');
  const box = nbaRecord(summary.boxscore);
  const players = new Map<string, Player>();
  const boxTeams = new Set<string>();
  for (const rawTeam of list(box.players)) {
    const team = nbaRecord(rawTeam);
    let populated = false;
    for (const rawStats of list(team.statistics)) {
      const stats = nbaRecord(rawStats);
      const labels = list(stats.names).length ? list(stats.names) : list(stats.labels);
      const columns = labels.map((label) => text(label).toUpperCase());
      for (const rawRow of list(stats.athletes)) {
        const row = nbaRecord(rawRow), athlete = nbaRecord(row.athlete);
        if (row.didNotPlay === true) continue;
        const values = list(row.stats);
        const stat = (names: string[]) => count(values[columns.findIndex((key) => names.includes(key))]);
        const points = stat(['PTS', 'POINTS']);
        if (!text(athlete.id) || !text(athlete.displayName) || points === undefined) continue;
        populated = true;
        players.set(text(athlete.id), { id: text(athlete.id), name: text(athlete.displayName), points,
          rebounds: stat(['REB', 'REBOUNDS']), assists: stat(['AST', 'ASSISTS']) });
      }
    }
    if (populated) boxTeams.add(text(nbaRecord(team.team).id));
  }
  const shots: Shot[] = list(summary.plays).flatMap((raw): Shot[] => {
    const play = nbaRecord(raw), value = count(play.scoreValue), clock = seconds(nbaRecord(play.clock).displayValue);
    const period = count(nbaRecord(play.period).number), awayScore = count(play.awayScore), homeScore = count(play.homeScore);
    const playerId = text(nbaRecord(nbaRecord(list(play.participants)[0]).athlete).id);
    if (play.scoringPlay !== true || play.shootingPlay !== true || (value !== 2 && value !== 3) || clock === undefined
      || period === undefined || awayScore === undefined || homeScore === undefined || !text(play.id) || !playerId) return [];
    return [{ id: text(play.id), playerId, teamId: text(nbaRecord(play.team).id), period, clock, value,
      away: awayScore, home: homeScore, sequence: count(play.sequenceNumber) ?? 0 }];
  }).sort((a, b) => a.period - b.period || b.clock - a.clock || a.sequence - b.sequence);
  return { id: text(event.id), date: text(event.date), status: state as NBAGame['status'], statusName: text(statusType.name),
    period: Math.max(count(status.period) ?? 0, ...shots.map((shot) => shot.period)), clock: seconds(status.displayClock),
    away, home, players: [...players.values()], shots, completeBox: boxTeams.has(away.id) && boxTeams.has(home.id) };
}

export function nbaCompletedPeriod(game: NBAGame): number {
  if (game.status === 'post') return Math.max(4, game.period);
  if (game.status === 'pre') return 0;
  if (game.statusName === 'STATUS_HALFTIME') return 2;
  if (game.statusName === 'STATUS_END_PERIOD') return game.period;
  return Math.max(0, game.period - 1);
}

export function buildNBAAlerts(game: NBAGame, previous: NBAAlertState | null): { state: NBAAlertState; alerts: NBAAlert[] } {
  const completed = nbaCompletedPeriod(game);
  const state: NBAAlertState = {
    status: game.status, trackedLive: previous?.trackedLive ?? game.status !== 'post', completedPeriod: Math.max(previous?.completedPeriod ?? 0, completed),
    points: { ...previous?.points }, finalPlayers: [...previous?.finalPlayers ?? []], buzzers: [...previous?.buzzers ?? []],
  };
  const alerts: NBAAlert[] = [];
  const eligible = previous !== null && state.trackedLive;
  const matchup = `${game.away.abbreviation} ${game.away.score} - ${game.home.abbreviation} ${game.home.score}`;
  // First observations establish a baseline rather than sending historical alerts.
  for (const player of game.players) {
    const before = previous?.points[player.id] ?? 0;
    state.points[player.id] = Math.max(before, player.points);
    if (eligible) {
      for (const threshold of [35, 40, 50, 60]) {
        if (before < threshold && player.points >= threshold) alerts.push({ key: `points:${player.id}:${threshold}`, kind: 'milestone',
          body: `${player.name} hits ${threshold} points · ${matchup}`, teamIds: [] });
      }
    }
    if (game.status === 'post' && player.points >= 35 && !state.finalPlayers.includes(player.id)
      && player.rebounds !== undefined && player.assists !== undefined) {
      state.finalPlayers.push(player.id);
      if (eligible) alerts.push({ key: `final:${player.id}`, kind: 'final-player',
        body: `Final: ${player.name} — ${player.points} PTS / ${player.rebounds} REB / ${player.assists} AST · ${matchup}`, teamIds: [] });
    }
  }
  if (previous && eligible && completed > previous.completedPeriod && completed > 0) {
    const final = game.status === 'post';
    const cumulative = (side: Side) => side.lines.length >= completed && side.lines.slice(0, completed).every((v) => v !== undefined)
      ? side.lines.slice(0, completed).reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
    const away = final ? game.away.score : cumulative(game.away), home = final ? game.home.score : cumulative(game.home);
    if (away !== undefined && home !== undefined) {
      const label = final ? 'Final' : completed === 2 ? 'Halftime' : completed <= 4 ? `End Q${completed}` : `End OT${completed - 4}`;
      alerts.push({ key: `quarter:${completed}`, kind: 'quarter', body: `${label}: ${game.away.abbreviation} ${away} - ${game.home.abbreviation} ${home}`,
        teamIds: [game.away.id, game.home.id] });
    } else state.completedPeriod = previous.completedPeriod;
  }
  for (const shot of game.shots) {
    if (shot.clock !== 0 || ![game.away.id, game.home.id].includes(shot.teamId)) continue;
    const halftime = shot.period === 2 && completed >= 2;
    const own = shot.teamId === game.away.id ? shot.away : shot.home;
    const opponent = shot.teamId === game.away.id ? shot.home : shot.away;
    const winner = game.status === 'post' && shot.period >= 4 && shot.period === completed && own > opponent && own - shot.value <= opponent
      && shot.away === game.away.score && shot.home === game.home.score
      && !game.shots.some((later) => later.period > shot.period || later.period === shot.period && later.sequence > shot.sequence);
    if (!halftime && !winner) continue;
    const key = `${halftime ? 'half' : 'winner'}:${shot.id}`;
    if (state.buzzers.includes(key)) continue;
    const player = game.players.find((entry) => entry.id === shot.playerId);
    if (!player) continue;
    state.buzzers.push(key);
    if (eligible) alerts.push({ key: `buzzer:${key}`, kind: 'buzzer',
      body: `${player.name}: ${halftime ? 'halftime buzzer-beater' : 'game-winning buzzer-beater'}! · ${game.away.abbreviation} ${shot.away} - ${game.home.abbreviation} ${shot.home}`, teamIds: [] });
  }
  return { state, alerts };
}

export function nbaNotificationHash(eventId: string, date: string): string {
  return `#wire/nba/${date}/${eventId}`;
}
