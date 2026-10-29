import { supabase } from './supabaseClient';
import type { PickOrder } from './gamewaireOrder';
import type { Candidate, Settings, Sport } from '../../supabase/functions/_shared/gamewaire';
export { defaultSettings, fullAnalysisSettings, markets, modelVersion, performance, performanceGroups, gamewaireGrade, probabilityGrade, rankTopPicks, pickBlurb } from '../../supabase/functions/_shared/gamewaire';
export type { Candidate, Settings, Sport, TeamLean } from '../../supabase/functions/_shared/gamewaire';
export type AnalysisStatus = 'in_progress' | 'completed' | 'no_qualifying' | 'insufficient_data' | 'stale_odds' | 'provider_error' | 'setup_required';
export type AnalysisRun = {
  id: string; sport: Sport; event_id: string; event_start: string; matchup: string; settings: Settings; status: AnalysisStatus;
  created_at: string; finished_at: string | null;
  payload: { picks?: Candidate[]; stretchKeys?: string[]; playerPropMinimum?: number; teamLean?: import('../../supabase/functions/_shared/gamewaire').TeamLean; rejected?: Array<{ key: string; reason: string }>; warnings?: string[]; error?: string; explanationMode?: string;
    providerUsage?: { requestCost: number | null; creditsUsed: number | null; creditsRemaining: number | null; checkedAt: string };
    scheduled?: { jobId: string; selectionNote: string } };
};
export type StoredPick = {
  id: string; run_id: string; sport: Sport; event_id: string; event_start: string; market: string; subject: string; side: string; line: number | null;
  american: number; probability: number; push_probability: number; data: Candidate;
  result: 'pending' | 'win' | 'loss' | 'push' | 'void'; closing_american: number | null; withdrawn: boolean;
  revision: number; created_at: string; settlement_note: string | null;
  is_top_pick: boolean; is_game_lean: boolean;
};
export type EngineStatus = { canAnalyze: boolean; oddsReady: boolean; aiReady: boolean; model: string; experimental: boolean };
export type StretchPick = { run_id: string; pick_key: string };
export type OddsEvent = { id: string; sport: Sport; home: string; away: string; start: string };
export type PublishedGame = {
  sport: Sport; event_id: string; run_id: string; event_start: string; matchup: string; picks: Candidate[]; published_at: string;
};
export type GameLean = { sport: Sport; event_id: string; event_start: string; matchup: string; team_lean: import('../../supabase/functions/_shared/gamewaire').TeamLean | null; updated_at: string };
export type ScheduleBatch = { id: string; sport: Sport; game_date: string; status: 'ready' | 'no_games' | 'error'; note: string; error: string | null };
export type ScheduleJob = { id: string; batch_id: string; sport: Sport; event_id: string; event_start: string; matchup: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'; run_id: string | null; error: string | null; selection_note: string };
export async function engineRequest<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new Error('Account services are not configured.');
  const session = await supabase.auth.getSession();
  if (session.error) throw session.error;
  const result = await supabase.functions.invoke<T>('gamewaire', { body, signal, headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ''}` } });
  if (result.error) {
    const response = result.error.context;
    if (response instanceof Response) {
      const data: unknown = await response.json();
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
        const retryAt = 'retryAt' in data && typeof data.retryAt === 'string' ? Date.parse(data.retryAt) : NaN;
        throw new Error(`${data.error}${Number.isFinite(retryAt) ? ` Try again at ${new Date(retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}.` : ''}`);
      }
    }
    throw new Error(result.error.message || 'GamewAIre request failed.');
  }
  if (!result.data) throw new Error('GamewAIre returned an empty response.');
  return result.data;
}
export async function loadEngineHistory(signal: AbortSignal, canAnalyze = false) {
  if (!supabase) throw new Error('Account services are not configured.');
  const runs = canAnalyze ? await supabase.from('gamewaire_runs').select('*').order('created_at', { ascending: false }).limit(50).abortSignal(signal)
    : { data: [], error: null };
  if (runs.error) throw new Error(`Could not load GamewAIre reports: ${runs.error.message}`);
  const [published, orders] = await Promise.all([
    supabase.from('gamewaire_publications').select('*').order('event_start', { ascending: false }).limit(200).abortSignal(signal),
    supabase.from('gamewaire_pick_orders').select('*').order('game_date', { ascending: false }).limit(200).abortSignal(signal),
  ]);
  if (published.error) throw new Error(`Could not load published GamewAIre games: ${published.error.message}`);
  if (orders.error) throw new Error(`Could not load published pick order: ${orders.error.message}`);
  const picks: StoredPick[] = [];
  const leans = await supabase.from('gamewaire_team_leans').select('*').order('event_start', { ascending: false }).limit(200).abortSignal(signal);
  if (leans.error) throw new Error(`Could not load GamewAIre team leans: ${leans.error.message}`);
  const batches = canAnalyze ? await supabase.from('gamewaire_schedule_batches').select('*').order('game_date', { ascending: false }).limit(14).abortSignal(signal)
    : { data: [], error: null };
  if (batches.error) throw new Error(`Could not load scheduled analysis status: ${batches.error.message}`);
  const jobs = canAnalyze && batches.data.length ? await supabase.from('gamewaire_schedule_jobs').select('*').in('batch_id', batches.data.map((batch) => batch.id))
    .order('event_start', { ascending: false }).abortSignal(signal) : { data: [], error: null };
  if (jobs.error) throw new Error(`Could not load scheduled game reports: ${jobs.error.message}`);
  for (let offset = 0; ; offset += 500) {
    const page = await supabase.from('gamewaire_picks').select('*').or('is_top_pick.eq.true,is_game_lean.eq.true')
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 499).abortSignal(signal);
    if (page.error) throw new Error(`Could not load complete model performance: ${page.error.message}`);
    picks.push(...page.data);
    if (page.data.length < 500) break;
  }
  const stretches: StretchPick[] = [];
  if (canAnalyze) for (let offset = 0; ; offset += 500) {
    const page = await supabase.from('gamewaire_stretch_picks').select('run_id,pick_key')
      .order('run_id').order('pick_key').range(offset, offset + 499).abortSignal(signal);
    if (page.error) throw new Error(`Could not load private Stretch labels: ${page.error.message}`);
    stretches.push(...page.data);
    if (page.data.length < 500) break;
  }
  return { runs: runs.data as AnalysisRun[], picks, published: published.data as PublishedGame[], leans: leans.data as GameLean[],
    batches: batches.data as ScheduleBatch[], jobs: jobs.data as ScheduleJob[], orders: orders.data as PickOrder[], stretches };
}
