import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Sport } from './gamewaire.ts';

export type ScheduleEvent = { id: string; sport: Sport; home: string; away: string; start: string };
export type ScheduledJob = {
  id: string; sport: Sport; event_id: string; event_start: string; matchup: string; selection_note: string;
};
export function easternClock(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), weekday: part('weekday') };
}
export function scheduleWindow(_sport: Sport, date: string) {
  return { first: date, last: date };
}
export function scheduleEvents(events: ScheduleEvent[], sport: Sport, date: string, now: number) {
  const window = scheduleWindow(sport, date);
  return events.filter((event) => {
    const day = easternClock(Date.parse(event.start)).date;
    return event.sport === sport && day >= window.first && day <= window.last && Date.parse(event.start) > now;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}
export async function planScheduledAnalyses(admin: SupabaseClient, listEvents: (sport: Sport) => Promise<ScheduleEvent[]>,
  _fetcher: typeof fetch = fetch, now = Date.now()) {
  const clock = easternClock(now);
  if (clock.hour !== 1) return;
  const sports: Sport[] = ['NBA', 'NFL'];
  for (const sport of sports) {
    const existing = await admin.from('gamewaire_schedule_batches').select('id').eq('sport', sport).eq('game_date', clock.date).maybeSingle();
    if (existing.error) throw new Error('Could not read the scheduled analysis plan.');
    if (existing.data) continue;
    let games: Array<ScheduleEvent & { selection_note: string }> = [], error: string | null = null;
    const note = `Every upcoming ${sport} game today. Moneyline/spread only; private until reviewed and published.`;
    try {
      const events = scheduleEvents(await listEvents(sport), sport, clock.date, now);
      games = events.map((event) => ({ ...event, selection_note: note }));
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
