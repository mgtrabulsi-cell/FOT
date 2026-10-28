import { supabase } from './supabaseClient';
import type { Candidate, Settings, Sport } from '../../supabase/functions/_shared/gamewaire';
export { defaultSettings, markets, modelVersion, performance, performanceGroups, gamewaireGrade, probabilityGrade, rankTopPicks } from '../../supabase/functions/_shared/gamewaire';
export type { Candidate, Settings, Sport };
export type AnalysisStatus = 'in_progress' | 'completed' | 'no_qualifying' | 'insufficient_data' | 'stale_odds' | 'provider_error' | 'setup_required';
export type AnalysisRun = {
  id: string; sport: Sport; event_id: string; event_start: string; matchup: string; settings: Settings; status: AnalysisStatus;
  created_at: string; finished_at: string | null;
  payload: { picks?: Candidate[]; rejected?: Array<{ key: string; reason: string }>; warnings?: string[]; error?: string; explanationMode?: string };
};
export type StoredPick = {
  id: string; sport: Sport; event_id: string; event_start: string; market: string; subject: string; side: string; line: number | null;
  american: number; probability: number; push_probability: number; data: Candidate;
  result: 'pending' | 'win' | 'loss' | 'push' | 'void'; closing_american: number | null; withdrawn: boolean;
  revision: number; created_at: string; settlement_note: string | null;
};
export type EngineStatus = { canAnalyze: boolean; oddsReady: boolean; aiReady: boolean; model: string; experimental: boolean };
export type OddsEvent = { id: string; sport: Sport; home: string; away: string; start: string };
export type PublishedGame = {
  sport: Sport; event_id: string; run_id: string; event_start: string; matchup: string; picks: Candidate[]; published_at: string;
};
export async function engineRequest<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new Error('Account services are not configured.');
  const session = await supabase.auth.getSession();
  if (session.error) throw session.error;
  const result = await supabase.functions.invoke<T>('gamewaire', { body, signal, headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ''}` } });
  if (result.error) {
    const response = result.error.context;
    if (response instanceof Response) {
      const data: unknown = await response.json();
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') throw new Error(data.error);
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
  const published = await supabase.from('gamewaire_publications').select('*').order('event_start', { ascending: false }).limit(200).abortSignal(signal);
  if (published.error) throw new Error(`Could not load published GamewAIre games: ${published.error.message}`);
  const picks: StoredPick[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await supabase.from('gamewaire_picks').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 499).abortSignal(signal);
    if (page.error) throw new Error(`Could not load complete model performance: ${page.error.message}`);
    picks.push(...page.data);
    if (page.data.length < 500) break;
  }
  return { runs: runs.data as AnalysisRun[], picks, published: published.data as PublishedGame[] };
}
