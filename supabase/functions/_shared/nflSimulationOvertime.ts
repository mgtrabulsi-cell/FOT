import { array, object, text } from './gamewaire.ts';

export type OvertimeDrive = { eventId: string; driveId: string; teamId: string; seconds: number; offensePoints: number; defensePoints: number };
export type OvertimeEvidence = { home: OvertimeDrive[]; away: OvertimeDrive[] };
export const overtimeRulesSource = 'https://operations.nfl.com/rules-officiating/2026-nfl-rulebook';
export const overtimeMethod = 'empirical-possession-bootstrap-v1';

export function readOvertimeDrives(value: unknown, eventId: string): OvertimeDrive[] {
  const data = object(value), competition = object(array(object(data.header).competitions)[0]);
  const sides = array(competition.competitors).map(object);
  const home = text(object(sides.find(side => side.homeAway === 'home')?.team).id);
  const away = text(object(sides.find(side => side.homeAway === 'away')?.team).id);
  if (!home || !away || object(object(competition.status).type).completed !== true) return [];
  const seen = new Set<string>();
  return array(object(data.drives).previous).flatMap(raw => {
    const drive = object(raw), id = text(drive.id), teamId = text(object(drive.team).id);
    const start = Number(object(object(drive.start).period).number), end = Number(object(object(drive.end).period).number);
    const duration = /^(\d+):([0-5]\d)$/.exec(text(object(drive.timeElapsed).displayValue));
    const plays = array(drive.plays).map(object), first = plays[0], last = plays.at(-1);
    // Exclude incomplete possessions, half-ending series, OT, and kick-only series.
    if (!id || seen.has(id) || ![home, away].includes(teamId) || !duration || !first || !last || first.scoringPlay === true
      || start < 1 || end > 4 || start > end || start <= 2 && end > 2
      || !['TD', 'FG', 'PUNT', 'INT', 'FUMBLE', 'DOWNS', 'SF'].includes(text(drive.result))
      || !plays.some(play => /pass|rush|sack/i.test(text(object(play.type).text)))) return [];
    const seconds = Number(duration[1]) * 60 + Number(duration[2]);
    const h = Number(last.homeScore) - Number(first.homeScore), a = Number(last.awayScore) - Number(first.awayScore);
    const offensePoints = teamId === home ? h : a, defensePoints = teamId === home ? a : h;
    if (seconds <= 0 || seconds > 900 || ![0, 2, 3, 6, 7, 8].includes(offensePoints)
      || ![0, 2, 6, 7, 8].includes(defensePoints) || offensePoints > 0 && defensePoints > 0
      || drive.result === 'TD' && Math.max(offensePoints, defensePoints) < 6
      || drive.result === 'FG' && offensePoints !== 3 || drive.result === 'SF' && defensePoints !== 2
      || /end (half|game)/i.test(plays.map(play => text(object(play.type).text)).join(' '))) return [];
    seen.add(id);
    return [{ eventId, driveId: id, teamId, seconds, offensePoints, defensePoints }];
  });
}

export function validateOvertimeEvidence(evidence: OvertimeEvidence): void {
  for (const rows of [evidence.home, evidence.away]) {
    if (rows.length < 24 || new Set(rows.map(row => row.eventId)).size < 8
      || new Set(rows.map(row => `${row.eventId}:${row.driveId}`)).size !== rows.length
      || new Set(rows.map(row => row.teamId)).size !== 1
      || !rows.some(row => row.offensePoints > 0 || row.defensePoints > 0)
      || rows.some(row => !/^\d+$/.test(row.eventId) || !row.driveId || !row.teamId
        || !Number.isInteger(row.seconds) || row.seconds <= 0 || row.seconds > 900
        || ![0, 2, 3, 6, 7, 8].includes(row.offensePoints) || ![0, 2, 6, 7, 8].includes(row.defensePoints)))
      throw new Error('Overtime requires at least 24 verified completed possessions from eight prior games per team, including observed scoring.');
  }
  if (evidence.home[0].teamId === evidence.away[0].teamId) throw new Error('Overtime possession cohorts must identify different teams.');
}

export function simulateOvertime(home: number, away: number, seasonType: 2 | 3, evidence: OvertimeEvidence, random: () => number) {
  if (home !== away) return { home, away, played: false };
  let possession = random() < .5 ? 0 : 1, elapsed = 0;
  const possessed = [false, false];
  // A bounded failure is not converted to a fabricated playoff tie or winner.
  for (let n = 0; n < 4096; n++) {
    const rows = possession === 0 ? evidence.home : evidence.away;
    const drive = rows[Math.floor(random() * rows.length)];
    if (!drive) throw new Error('Overtime possession evidence is unavailable.');
    elapsed += drive.seconds;
    if (seasonType === 2 && elapsed > 600) return { home, away, played: true };
    const suddenDeath = possessed.every(Boolean);
    const own = possession === 0 ? home : away, opponent = possession === 0 ? away : home;
    const offensePoints = drive.offensePoints >= 6 && (suddenDeath
      || (possessed[1 - possession] || seasonType === 2 && elapsed >= 600) && own + 6 > opponent)
      ? 6 : drive.offensePoints;
    const defensePoints = drive.defensePoints >= 6 ? 6 : drive.defensePoints;
    if (possession === 0) { home += offensePoints; away += defensePoints; }
    else { away += offensePoints; home += defensePoints; }
    possessed[possession] = true;
    if (drive.defensePoints > 0 || (suddenDeath || possessed.every(Boolean)) && home !== away)
      return { home, away, played: true };
    if (seasonType === 2 && elapsed >= 600) return { home, away, played: true };
    possession = 1 - possession;
  }
  throw new Error('Postseason overtime exceeded the empirical possession simulation safety bound.');
}
