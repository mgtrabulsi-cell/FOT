import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, isSoccer, markets, numeric, object, text } from './gamewaire.ts';
import type { Sport } from './gamewaire.ts';
import { publicJSON, teamNameKey } from './gamewaireSources.ts';
import { soccerName, soccerPaths } from './gamewaireSoccer.ts';

export type SettlementPick = {
  id: string; sport: Sport; event_id: string; event_start: string; market: string;
  subject: string; side: string; line: number | null; data: unknown; revision: number;
};
type Outcome = { result: 'win' | 'loss' | 'push'; note: string };
const paths: Record<Sport, string> = { NFL: 'football/nfl', NBA: 'basketball/nba', ...soccerPaths };
const nflMetrics: Record<string, { category: string; key: string }> = {
  player_pass_yds: { category: 'passing', key: 'passingYards' },
  player_rush_yds: { category: 'rushing', key: 'rushingYards' },
  player_reception_yds: { category: 'receiving', key: 'receivingYards' },
  player_receptions: { category: 'receiving', key: 'receptions' },
};
const nbaMetrics: Record<string, string> = {
  player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST', player_threes: '3PT',
};
const soccerMetrics: Record<string, string> = {
  player_shots: 'totalShots', player_shots_on_target: 'shotsOnTarget', player_assists: 'goalAssists',
};

function playerValue(summary: Record<string, unknown>, pick: SettlementPick): number {
  const identifiers = object(object(pick.data).identifiers), playerId = text(identifiers.playerId), teamId = text(identifiers.teamId);
  if (!playerId || !teamId) throw new Error('Verified player/team identifiers are missing; manual review required.');
  if (isSoccer(pick.sport)) {
    const roster = array(summary.rosters).map(object).find(row => text(object(row.team).id) === teamId);
    const players = array(roster?.roster).map(object).filter(row => text(object(row.athlete).id) === playerId);
    if (players.length !== 1) throw new Error('The final roster does not identify this player uniquely.');
    const stats = array(players[0].stats).map(object);
    if (numeric(stats.find(row => row.name === 'appearances')?.value) !== 1) throw new Error('Player participation is not verified; no DNP settlement is assumed.');
    const value = numeric(stats.find(row => row.name === soccerMetrics[pick.market])?.value);
    if (value === undefined || !Number.isInteger(value) || value < 0) throw new Error('The final player statistic is missing or invalid.');
    return value;
  }
  const teams = array(object(summary.boxscore).players).map(object).filter(row => text(object(row.team).id) === teamId);
  if (teams.length !== 1) throw new Error('The final box score does not identify the player team uniquely.');
  const metric = nflMetrics[pick.market];
  const groups = array(teams[0].statistics).map(object).filter(row => pick.sport === 'NBA' || row.name === metric?.category);
  const values: number[] = [];
  for (const group of groups) {
    const players = array(group.athletes).map(object).filter(row => text(object(row.athlete).id) === playerId);
    if (!players.length) continue;
    if (players.length !== 1 || players[0].didNotPlay === true) {
      throw new Error('Player participation is not verified; no DNP settlement is assumed.');
    }
    const columns = array(pick.sport === 'NBA' ? group.names : group.keys);
    const index = columns.indexOf(pick.sport === 'NBA' ? nbaMetrics[pick.market] : metric?.key);
    if (index < 0) continue;
    const raw = array(players[0].stats)[index];
    let value = numeric(raw);
    if (pick.sport === 'NBA' && pick.market === 'player_threes' && typeof raw === 'string') {
      const made = raw.match(/^(\d+)-(\d+)$/);
      if (made && Number(made[1]) <= Number(made[2])) value = Number(made[1]);
    }
    if (value === undefined || !Number.isInteger(value) || (value < 0 && !['player_pass_yds', 'player_rush_yds', 'player_reception_yds'].includes(pick.market))) {
      throw new Error('The final player statistic is missing or invalid.');
    }
    values.push(value);
  }
  if (values.length !== 1) throw new Error('The final player statistic is missing or ambiguous; no zero is substituted.');
  return values[0];
}

export function gradePublishedPick(summary: unknown, pick: SettlementPick): Outcome | null {
  const data = object(pick.data), identifiers = object(data.identifiers);
  const eventId = text(identifiers.espnEventId);
  if (!/^\d+$/.test(eventId)) throw new Error('The published pick is missing a verified sports-data event ID.');
  if (data.eventId !== pick.event_id || data.sport !== pick.sport || data.market !== pick.market
    || data.side !== pick.side || data.subject !== pick.subject || data.line !== pick.line
    || Date.parse(text(data.start)) !== Date.parse(pick.event_start)
    || !(markets[pick.sport] as readonly string[]).includes(pick.market)) throw new Error('Published pick identity or market does not match its saved analysis.');
  const body = object(summary), header = object(body.header), competitions = array(header.competitions);
  if (text(header.id) !== eventId || competitions.length !== 1) throw new Error('Final game identity is missing or ambiguous.');
  const game = object(competitions[0]), status = object(game.status), state = object(status.type);
  const started = Date.parse(text(header.date) || text(game.date));
  const key = isSoccer(pick.sport) ? soccerName : teamNameKey;
  const sides = array(game.competitors).map(object);
  const home = sides.filter(row => row.homeAway === 'home'), away = sides.filter(row => row.homeAway === 'away');
  if (home.length !== 1 || away.length !== 1 || !text(data.home) || !text(data.away)
    || key(text(object(home[0].team).displayName)) !== key(text(data.home))
    || key(text(object(away[0].team).displayName)) !== key(text(data.away))
    || !Number.isFinite(started) || Math.abs(started - Date.parse(pick.event_start)) > (isSoccer(pick.sport) ? 5 : 360) * 60_000) {
    throw new Error('Final game teams or start time do not match the published pick.');
  }
  if (state.completed !== true || state.state !== 'post') return null;
  if (isSoccer(pick.sport)
    ? state.name !== 'STATUS_FULL_TIME' || (status.period !== undefined && numeric(status.period) !== 2)
    : state.name !== 'STATUS_FINAL') {
    throw new Error('A normal completed game is not verified; canceled or shortened markets require review.');
  }
  const score = (row: Record<string, unknown>) => numeric(row.score) ?? numeric(object(row.score).value);
  if (pick.market.startsWith('player_') && !sides.some(row => text(object(row.team).id) === text(identifiers.teamId))) {
    throw new Error('The saved player team is not part of this final game.');
  }
  const homeScore = score(home[0]), awayScore = score(away[0]);
  if (homeScore === undefined || awayScore === undefined || !Number.isInteger(homeScore) || !Number.isInteger(awayScore)
    || homeScore < 0 || awayScore < 0 || (pick.sport === 'NBA' && homeScore === awayScore)) throw new Error('Verified final scores are missing or invalid.');
  let margin: number, actual: number | undefined;
  if (pick.market === 'h2h' || pick.market === 'spreads') {
    if (isSoccer(pick.sport) && pick.market === 'h2h' && pick.side === 'Draw') margin = homeScore === awayScore ? 1 : -1;
    else {
      const isHome = key(pick.side) === key(text(data.home)), isAway = key(pick.side) === key(text(data.away));
      if (isHome === isAway) throw new Error('The selected team cannot be verified.');
      margin = isHome ? homeScore - awayScore : awayScore - homeScore;
      if (isSoccer(pick.sport) && pick.market === 'h2h' && margin === 0) margin = -1;
    }
    if (pick.market === 'spreads') {
      if (pick.line === null || !Number.isFinite(pick.line)) throw new Error('The original spread is missing.');
      margin += pick.line;
    }
  } else {
    if (pick.line === null || !Number.isFinite(pick.line) || !['Over', 'Under'].includes(pick.side)) throw new Error('The original line or direction is missing.');
    actual = pick.market === 'totals' ? homeScore + awayScore : playerValue(body, pick);
    margin = (actual - pick.line) * (pick.side === 'Over' ? 1 : -1);
  }
  const result = Math.abs(margin) < 1e-8 ? 'push' : margin > 0 ? 'win' : 'loss';
  return { result, note: `Automatically graded from verified final data: ${text(data.away)} ${awayScore}, ${text(data.home)} ${homeScore}.${actual === undefined ? '' : ` ${pick.market}: ${actual}; original ${pick.side} ${pick.line}.`} ${isSoccer(pick.sport) ? '90 minutes plus stoppage time.' : 'Full game, including overtime.'} Source event ${eventId}.` };
}

export async function settlePublishedPicks(admin: SupabaseClient, fetcher: typeof fetch = fetch) {
  const rows: SettlementPick[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await admin.from('gamewaire_picks').select('id,sport,event_id,event_start,market,subject,side,line,data,revision')
      .eq('result', 'pending').eq('withdrawn', false).is('settled_at', null)
      .or('is_top_pick.eq.true,is_game_lean.eq.true').lte('event_start', new Date().toISOString())
      .order('event_start').order('id').range(offset, offset + 499);
    if (page.error) throw new Error('Could not read published picks awaiting final results.');
    rows.push(...page.data);
    if (page.data.length < 500) break;
  }
  const groups = new Map<string, SettlementPick[]>();
  for (const row of rows) {
    const key = `${row.sport}:${text(object(object(row.data).identifiers).espnEventId)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let settled = 0, pending = 0, conflicts = 0;
  const issues: string[] = [], games = [...groups.values()];
  for (let offset = 0; offset < games.length; offset += 4) {
    await Promise.all(games.slice(offset, offset + 4).map(async picks => {
      let summary: unknown;
      try {
        const eventId = text(object(object(picks[0].data).identifiers).espnEventId);
        if (!/^\d+$/.test(eventId) || !paths[picks[0].sport]) throw new Error('Verified game identifiers are unavailable.');
        summary = await publicJSON(`https://site.api.espn.com/apis/site/v2/sports/${paths[picks[0].sport]}/summary?event=${eventId}`, fetcher);
      } catch (cause) {
        console.error('Published pick final data failed', picks[0].event_id, cause);
        pending += picks.length;
        issues.push(`${picks[0].event_id}: ${cause instanceof Error ? cause.message : 'Final game data unavailable.'}`);
        return;
      }
      for (const pick of picks) {
        try {
          const outcome = gradePublishedPick(summary, pick);
          if (!outcome) { pending++; continue; }
          const saved = await admin.from('gamewaire_picks').update({ result: outcome.result, settlement_note: outcome.note,
            settled_at: new Date().toISOString(), revision: pick.revision + 1 })
            .eq('id', pick.id).eq('revision', pick.revision).eq('result', 'pending').eq('withdrawn', false).is('settled_at', null)
            .select('id').maybeSingle();
          if (saved.error) throw new Error('Could not save the verified pick result.');
          if (saved.data) settled++;
          else conflicts++;
        } catch (cause) {
          console.error('Published pick settlement failed', pick.id, cause);
          pending++;
          issues.push(`${pick.id}: ${cause instanceof Error ? cause.message : 'Verified pick result unavailable.'}`);
        }
      }
    }));
  }
  return { checked: rows.length, settled, pending, conflicts, issues };
}
