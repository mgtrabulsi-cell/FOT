import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isSoccer, modelVersion, soccerModelVersion } from './gamewaire.ts';
import type { Sport } from './gamewaire.ts';

export type ScheduleEvent = { id: string; sport: Sport; home: string; away: string; start: string };
export type ScheduledJob = {
  id: string; sport: Sport; event_id: string; event_start: string; matchup: string; selection_note: string;
};
export const scheduledSports: Sport[] = ['NBA', 'NFL', 'EPL', 'Serie A', 'La Liga', 'Bundesliga'];
export const scheduledMarkets = (sport: Sport) => isSoccer(sport) ? ['h2h', 'totals'] : ['h2h', 'spreads'];
export function easternClock(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(now));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')), weekday: part('weekday') };
}
export function scheduleWindow(sport: Sport, date: string) {
  const last = new Date(`${date}T12:00:00Z`);
  if (sport === 'NFL') last.setUTCDate(last.getUTCDate() + 6);
  return { first: date, last: last.toISOString().slice(0, 10) };
}
export function scheduledNFLDate(clock: { date: string; hour: number }) {
  const tuesday = new Date(`${clock.date}T12:00:00Z`);
  const weekday = tuesday.getUTCDay();
  tuesday.setUTCDate(tuesday.getUTCDate() - (weekday - 2 + 7) % 7 - (weekday === 2 && clock.hour < 12 ? 7 : 0));
  tuesday.setUTCDate(tuesday.getUTCDate() + 2);
  return tuesday.toISOString().slice(0, 10);
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
  if (clock.hour < 1) return;
  for (const sport of scheduledSports) {
    const version = isSoccer(sport) ? soccerModelVersion : modelVersion;
    const date = sport === 'NFL' ? scheduledNFLDate(clock) : clock.date;
    const note = `Every upcoming ${sport} game ${sport === 'NFL' ? 'Thursday through Wednesday (Tuesday noon week rollover)' : 'today'}. ${isSoccer(sport) ? 'Match result/totals' : 'Moneyline/spread'} only; up to 2 credits/game. Saved leans stay private until owner review and explicit publication. No scheduled player markets.${isSoccer(sport) ? ' Shared soccer cap: 40 attempts / 80 credits per Eastern day; excess games are visibly skipped.' : ''}`;
    const existing = await admin.from('gamewaire_schedule_batches').select('id,model_version').eq('sport', sport).eq('game_date', date).maybeSingle();
    if (existing.error) throw new Error('Could not read the scheduled analysis plan.');
    if (existing.data?.model_version === version) continue;
    let games: Array<ScheduleEvent & { selection_note: string }> = [], error: string | null = null;
    try {
      const events = scheduleEvents(await listEvents(sport), sport, date, now);
      const limit = sport === 'NBA' ? 15 : sport === 'NFL' ? 16 : 100;
      if (events.length > limit) throw new Error(`${sport} slate exceeds the ${limit}-game planning safety limit. No games silently omitted; owner review required.`);
      games = events.map((event) => ({ ...event, selection_note: note }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Scheduled game selection failed.';
      console.error('GamewAIre schedule planning failed', sport, error);
    }
    const saved = await admin.rpc('gamewaire_schedule_plan', { target_sport: sport, target_date: date, target_model: version,
      games: games.map((game) => ({ event_id: game.id, event_start: game.start, matchup: `${game.away} @ ${game.home}`, selection_note: game.selection_note })),
      problem: error, plan_note: note });
    if (saved.error) throw new Error(`Could not save the ${sport} schedule: ${saved.error.message}`);
  }
}
