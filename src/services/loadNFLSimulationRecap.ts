import { array, object, text } from '../../supabase/functions/_shared/gamewaire';
import { supabase } from './supabaseClient';
import { readAngles } from './theAngle';
import { loadSimulationAccuracy } from './gamewireBot';
import { readRecapFinal, recapAdminRows, simulationRecapSnapshot } from './nflSimulationRecap';
import type { RecapSpread } from './nflSimulationRecap';
import type { Game } from './sportsData';

export function readRecapSpreads(value: unknown, game: Game): RecapSpread[] {
  const runs = array(value).map(object).sort((a, b) => Date.parse(text(b.created_at)) - Date.parse(text(a.created_at)));
  for (const run of runs) {
    if (run.sport !== 'NFL' || Date.parse(text(run.event_start)) !== Date.parse(game.date)
      || !(Date.parse(text(run.created_at)) < Date.parse(game.date))) continue;
    const payload = object(run.payload), lean = object(payload.teamLean);
    for (const raw of [lean.pick, ...array(payload.picks)]) {
      const pick = object(raw);
      if (pick.sport !== 'NFL' || pick.market !== 'spreads' || text(object(pick.identifiers).espnEventId) !== game.eventId
        || Date.parse(text(pick.start)) !== Date.parse(game.date)
        || text(pick.home) !== game.home.name || text(pick.away) !== game.away.name
        || typeof pick.line !== 'number' || !Number.isFinite(pick.line)
        || !(Date.parse(text(pick.updatedAt)) < Date.parse(game.date))
        || !(Date.parse(text(pick.dataAt)) < Date.parse(game.date))) continue;
      const team = [game.home, game.away].find(team => team.name.toLowerCase() === text(pick.side).toLowerCase());
      if (team) return [{ teamId: team.id, line: pick.line, recordedAt: text(run.created_at) }];
    }
  }
  return [];
}

export async function loadNFLSimulationRecap(game: Game, signal: AbortSignal) {
  if (!supabase) throw new Error('Account services are not configured.');
  if (game.league !== 'NFL' || game.status !== 'FINAL') throw new Error('NFL sim recaps are available only after a game finishes.');
  const client = supabase;
  const loadStories = async () => {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from('angles').select('*').eq('status', 'published').eq('season', game.seasonYear)
        .in('game_id', [game.id, 'NFL:0']).order('id').range(offset, offset + 499).abortSignal(signal);
      if (result.error) throw new Error(`Could not load Analyst Desk picks: ${result.error.message}`);
      rows.push(...result.data);
      if (result.data.length < 500) return readAngles(rows);
    }
  };
  const [response, stories] = await Promise.all([
    fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(game.eventId)}`,
      { signal, cache: 'no-store' }), loadStories(),
  ]);
  if (!response.ok) throw new Error(`The final NFL box score could not load (${response.status}). Retry the recap.`);
  const summary: unknown = await response.json(), final = readRecapFinal(summary, game);
  if (recapAdminRows(stories, game, final).length) return simulationRecapSnapshot(game, summary, stories);
  const loadSpreads = async () => {
    for (let offset = 0; ; offset += 500) {
      const runs = await client.from('gamewaire_runs').select('sport,event_start,created_at,payload')
        .eq('sport', 'NFL').eq('event_start', game.date).lt('created_at', game.date)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 499).abortSignal(signal);
      if (runs.error) throw new Error(`Could not verify saved pregame spread lines: ${runs.error.message}`);
      const lines = readRecapSpreads(runs.data, game);
      if (lines.length || runs.data.length < 500) return lines;
    }
  };
  const [report, spreads] = await Promise.all([loadSimulationAccuracy([game], signal), loadSpreads()]);
  return simulationRecapSnapshot(game, summary, stories, report.games.find(row => row.eventId === game.eventId),
    spreads);
}
