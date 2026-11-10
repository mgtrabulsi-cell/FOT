import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { modelVersion } from './gamewaire.ts';
import type { Candidate, TeamLean } from './gamewaire.ts';
import { scoreboardPicks } from './gamewaireScoreboard.ts';
import { savedNFLGameSimulation } from './nflSimulationBackend.ts';
import type { NFLGameSimulation } from './nflSimulation.ts';

type WireSport = 'NBA' | 'NFL';
type SavedScore = { id: string; event_id: string; event_start: string; status: string;
  payload: { modelVersion?: string; teamLean?: TeamLean; winnerLean?: TeamLean } };
export const wireDay = (timestamp: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(timestamp));

export async function loadWireSelections(admin: SupabaseClient, sport: WireSport, first: string, last: string, now = Date.now()) {
  const start = new Date(Date.parse(first) - 86400000).toISOString();
  const end = new Date(Date.parse(last) + 2 * 86400000).toISOString();
  const inSlate = (start: string) => {
    const timestamp = Date.parse(start);
    return Number.isFinite(timestamp) && wireDay(timestamp) >= first && wireDay(timestamp) <= last;
  };
  const latest = new Map<string, SavedScore>();
  for (let offset = 0; ; offset += 500) {
    const saved = await admin.from('gamewaire_runs').select('id,event_id,event_start,payload,status,created_at')
      .eq('sport', sport).gte('event_start', start).lt('event_start', end)
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 499).returns<SavedScore[]>();
    if (saved.error) throw new Error('Could not load matchup scores for the scoreboard.');
    for (const row of saved.data) {
      if (!inSlate(row.event_start) || row.status === 'in_progress' || latest.has(row.event_id)) continue;
      latest.set(row.event_id, row);
    }
    if (saved.data.length < 500) break;
  }
  const candidates = [...latest.values()].flatMap(row => {
    const lean = row.payload?.teamLean;
    return row.payload?.modelVersion === modelVersion && lean?.qualifies === true ? [lean.pick] : [];
  });
  const jobs = await admin.from('gamewaire_schedule_jobs')
    .select('event_id,event_start,status,gamewaire_schedule_batches!inner(model_version)')
    .eq('sport', sport).eq('gamewaire_schedule_batches.model_version', modelVersion)
    .gte('event_start', start).lt('event_start', end)
    .returns<Array<{ event_id: string; event_start: string; status: string }>>();
  if (jobs.error) throw new Error('Could not load scoreboard analysis progress.');
  const countJobs = (statuses: string[]) => new Set(jobs.data.filter(job => inSlate(job.event_start) && statuses.includes(job.status)).map(job => job.event_id)).size;
  const slateGames = new Set([...latest.keys(), ...jobs.data.filter(job => inSlate(job.event_start)).map(job => job.event_id)]).size;
  const winners = [...latest.values()].flatMap(row => {
    const winner = row.payload?.winnerLean ?? (row.payload?.teamLean?.pick.market === 'h2h' ? row.payload.teamLean : undefined);
    return row.payload?.modelVersion === modelVersion && winner ? [winner] : [];
  });
  const nflSimulations = new Map<string, NFLGameSimulation>();
  if (sport === 'NFL') for (const candidate of candidates) {
    const eventId = candidate.identifiers?.espnEventId;
    if (candidate.market !== 'h2h' || !eventId || nflSimulations.has(eventId) || Date.parse(candidate.start) <= now) continue;
    const forecast = await savedNFLGameSimulation(admin, eventId, candidate.start);
    if (forecast) nflSimulations.set(eventId, forecast);
  }
  const selections: Array<{ runId: string; candidate: Candidate }> = [];
  const onSelection = (candidate: Candidate) => {
    const source = [...latest.values()].find(row => row.payload?.teamLean?.pick === candidate || row.payload?.winnerLean?.pick === candidate);
    if (!source) throw new Error('Automatic pick has no saved source analysis.');
    selections.push({ runId: source.id, candidate });
  };
  const picks = scoreboardPicks(candidates, now, { ...(sport === 'NBA' ? { nbaGames: slateGames, winnerLeans: winners } : { nflSimulations }), onSelection });
  return { selections, response: { picks,
    ...(sport === 'NBA' ? { dailyTarget: slateGames === 0 ? 0 : slateGames < 3 ? 1 : 3, selectionCount: picks.length } : {}),
    analyzedGames: [...latest.values()].filter(row => row.payload?.modelVersion === modelVersion).length,
    upcomingAnalyzedGames: [...latest.values()].filter(row => row.payload?.modelVersion === modelVersion && Date.parse(row.event_start) > now).length,
    pendingGames: countJobs(['pending', 'running']), failedGames: countJobs(['failed']),
    note: sport === 'NBA' ? 'Three distinct games per Eastern day, or one winner selection total on a 1–2-game slate. Value-qualified picks are prioritized; coverage-only winner leans are labeled separately. Missing evidence is not invented. No paid odds refresh or post publication is triggered.'
      : 'Ranked across saved matchup analyses. NFL moneyline picks must also match the saved default simulation winner; missing or tied simulations receive no moneyline label. No paid odds refresh or post publication is triggered.',
  } };
}

export async function recordWireSelections(admin: SupabaseClient, selections: Array<{ runId: string; candidate: Candidate }>, now = Date.now()) {
  let recorded = 0;
  for (const selection of selections) {
    if (Date.parse(selection.candidate.start) <= now) continue;
    const saved = await admin.rpc('gamewaire_track_automatic_pick', { target_run: selection.runId, candidate: selection.candidate });
    if (saved.error) throw new Error(`Could not record automatic Wire pick: ${saved.error.message}`);
    if (saved.data === true) recorded++;
  }
  return recorded;
}

export async function syncAutomaticWirePicks(admin: SupabaseClient, now = Date.now()) {
  const slates = new Map<string, { sport: WireSport; first: string; last: string }>();
  for (let offset = 0; ; offset += 500) {
    const page = await admin.from('gamewaire_runs').select('sport,event_start')
      .in('sport', ['NBA', 'NFL']).gt('event_start', new Date(now).toISOString())
      .lt('event_start', new Date(now + 8 * 86400000).toISOString())
      .order('event_start').order('id').range(offset, offset + 499)
      .returns<Array<{ sport: WireSport; event_start: string }>>();
    if (page.error) throw new Error('Could not load upcoming automatic-pick slates.');
    for (const row of page.data) {
      const day = wireDay(Date.parse(row.event_start));
      const first = new Date(`${day}T12:00:00Z`);
      // NFL slates run Tuesday through Monday, including Monday night.
      if (row.sport === 'NFL') first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 5) % 7);
      const last = new Date(first);
      if (row.sport === 'NFL') last.setUTCDate(last.getUTCDate() + 6);
      const slate = { sport: row.sport, first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10) };
      slates.set(`${row.sport}:${slate.first}`, slate);
    }
    if (page.data.length < 500) break;
  }
  let recorded = 0;
  for (const slate of slates.values()) {
    const { selections } = await loadWireSelections(admin, slate.sport, slate.first, slate.last, now);
    recorded += await recordWireSelections(admin, selections, now);
  }
  return recorded;
}
