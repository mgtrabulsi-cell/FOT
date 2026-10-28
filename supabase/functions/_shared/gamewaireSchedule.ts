import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { array, numeric, object, text } from './gamewaire.ts';
import type { Sport } from './gamewaire.ts';
import { publicJSON, teamNameKey } from './gamewaireSources.ts';

export type ScheduleEvent = { id: string; sport: Sport; home: string; away: string; start: string };
export type ScheduledJob = {
  id: string; sport: Sport; event_id: string; event_start: string; matchup: string; selection_note: string;
};
type Standing = { wins: number; losses: number };
export function easternClock(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), weekday: part('weekday') };
}
export function scheduleWindow(sport: Sport, date: string) {
  const last = new Date(`${date}T12:00:00Z`);
  if (sport === 'NFL') last.setUTCDate(last.getUTCDate() + 4);
  return { first: date, last: last.toISOString().slice(0, 10) };
}
export function scheduleEvents(events: ScheduleEvent[], sport: Sport, date: string, now: number) {
  const window = scheduleWindow(sport, date);
  return events.filter((event) => {
    const day = easternClock(Date.parse(event.start)).date;
    return event.sport === sport && day >= window.first && day <= window.last && Date.parse(event.start) > now;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}
export function readStandings(value: unknown): Map<string, Standing> {
  const result = new Map<string, Standing>();
  const visit = (value: unknown) => {
    const row = object(value);
    for (const raw of array(object(row.standings).entries)) {
      const entry = object(raw), stats = array(entry.stats).map(object), team = text(object(entry.team).displayName);
      const wins = numeric(stats.find((stat) => stat.name === 'wins')?.value);
      const losses = numeric(stats.find((stat) => stat.name === 'losses')?.value);
      if (team && wins !== undefined && losses !== undefined && wins >= 0 && losses >= 0) result.set(teamNameKey(team), { wins, losses });
    }
    array(row.children).forEach(visit);
  };
  visit(value);
  if (!result.size) throw new Error('NBA standings are unavailable; no arbitrary games were selected.');
  return result;
}
export function rankNBAMatchups(events: ScheduleEvent[], current: Map<string, Standing>, previous: Map<string, Standing>) {
  const strength = (name: string) => {
    const row = current.get(teamNameKey(name)), prior = previous.get(teamNameKey(name));
    if (!row) return null;
    const games = row.wins + row.losses;
    if (games >= 12) return { value: row.wins / games, blended: false };
    if (!prior || prior.wins + prior.losses === 0) return null;
    const last = prior.wins / (prior.wins + prior.losses);
    return { value: games ? (row.wins / games + last) / 2 : last, blended: true };
  };
  const ranked = events.flatMap((event) => {
    const home = strength(event.home), away = strength(event.away);
    if (!home || !away) return [];
    return [{ ...event, strength: Math.min(home.value, away.value), gap: Math.abs(home.value - away.value),
      selection_note: `Matchup appeal: both teams' standings strength first, then evenly matched records.${home.blended || away.blended
        ? ' Early season uses a 50/50 current/prior-season win-rate blend until 12 games per team (prior season only before a team plays).' : ' Current-season records (12+ games per team).'} Not a betting-value ranking.` }];
  }).sort((a, b) => b.strength - a.strength || a.gap - b.gap || Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  return { games: ranked.slice(0, 3), omitted: events.length - ranked.length };
}
export async function planScheduledAnalyses(admin: SupabaseClient, listEvents: (sport: Sport) => Promise<ScheduleEvent[]>,
  fetcher: typeof fetch = fetch, now = Date.now()) {
  const clock = easternClock(now);
  if (clock.hour !== 1) return;
  const sports: Sport[] = clock.weekday === 'Thu' ? ['NBA', 'NFL'] : ['NBA'];
  for (const sport of sports) {
    const existing = await admin.from('gamewaire_schedule_batches').select('id').eq('sport', sport).eq('game_date', clock.date).maybeSingle();
    if (existing.error) throw new Error('Could not read the scheduled analysis plan.');
    if (existing.data) continue;
    let games: Array<ScheduleEvent & { selection_note: string }> = [], error: string | null = null;
    let note = sport === 'NBA' ? 'Top three standings-ranked matchups.' : 'Upcoming Thursday-through-Monday NFL slate.';
    try {
      const events = scheduleEvents(await listEvents(sport), sport, clock.date, now);
      if (sport === 'NBA' && events.length) {
        const date = new Date(`${clock.date}T12:00:00Z`), season = date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0);
        const [currentRaw, previousRaw] = await Promise.all([season, season - 1].map((year) =>
          publicJSON(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${year}&type=0&level=2`, fetcher)));
        if (numeric(object(object(currentRaw).season).year) !== season || numeric(object(object(previousRaw).season).year) !== season - 1)
          throw new Error('NBA standings returned the wrong season; scheduled selection stopped.');
        const ranked = rankNBAMatchups(events, readStandings(currentRaw), readStandings(previousRaw));
        games = ranked.games;
        if (ranked.omitted) note += ` ${ranked.omitted} games excluded for missing standings.`;
        if (!games.length) throw new Error('No NBA games had complete standings for both teams.');
      } else games = events.map((event) => ({ ...event, selection_note: note }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Scheduled game selection failed.';
      console.error('GamewAIre schedule planning failed', sport, error);
    }
    const saved = await admin.rpc('gamewaire_schedule_plan', { target_sport: sport, target_date: clock.date,
      games: games.map((game) => ({ event_id: game.id, event_start: game.start, matchup: `${game.away} @ ${game.home}`, selection_note: game.selection_note })),
      problem: error, plan_note: note });
    if (saved.error) throw new Error(`Could not save the ${sport} schedule: ${saved.error.message}`);
  }
}
