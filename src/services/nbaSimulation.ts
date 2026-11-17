import { supabase } from './supabaseClient';
import { createDraftStorage } from './draftStorage';
import { readNBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation';
import type { NBAAccuracyReport, NBAActuals, NBAGameSimulation } from '../../supabase/functions/_shared/nbaSimulation';
import type { Game } from './sportsData';

const storage = createDraftStorage('gamewire-nba-simulations');
const memory = new Map<string, NBAGameSimulation>();
const key = (game: Game) => `${game.eventId}:${Date.parse(game.date)}:${game.home.id}:${game.away.id}`;
const parse = (game: Game, value: unknown) => readNBAGameSimulation(value, game.eventId, game.date, { home: game.home.id, away: game.away.id });
const scope = (game: Game) => ({ eventId: game.eventId, kickoff: game.date, homeTeamId: game.home.id, awayTeamId: game.away.id });
async function request(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (!supabase) throw new Error('NBA simulation account services are not configured.');
  const session = await supabase.auth.getSession();
  if (session.error) throw session.error;
  if (!session.data.session || session.data.session.user.is_anonymous) throw new Error('Sign in to view GamewAIre NBA simulations.');
  signal.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => controller.abort();
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => { controller.abort(); reject(signal.reason ?? new Error('NBA simulation loading was cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { reject(new Error('NBA simulation refresh timed out. Saved forecasts remain available.')); controller.abort(); }, 15000);
  });
  try {
    const result = await Promise.race([supabase.functions.invoke<unknown>('nba-simulation', { body, signal: controller.signal,
      headers: { Authorization: `Bearer ${session.data.session.access_token}` } }), deadline]);
    if (result.error) {
      if (result.error.context instanceof Response) {
        const detail: unknown = await result.error.context.json();
        if (detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string') throw new Error(detail.error);
      }
      throw new Error(result.error.message || 'NBA simulations could not refresh.');
    }
    if (!result.data) throw new Error('NBA simulation returned an empty response.');
    return result.data;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
export async function readSavedNBASimulation(game: Game): Promise<NBAGameSimulation | null> {
  const cached = memory.get(key(game));
  if (cached) return cached;
  try {
    const value = await storage.load(key(game));
    if (value === undefined) return null;
    const result = parse(game, value);
    if (result.status !== 'ready') throw new Error('Saved NBA forecast is incomplete.');
    const latest = memory.get(key(game)) ?? result;
    memory.set(key(game), latest);
    return latest;
  } catch (cause) { console.error('Could not restore NBA simulation for offline use', game.eventId, cause); return null; }
}
export async function loadNBASimulation(game: Game, signal: AbortSignal): Promise<NBAGameSimulation> {
  const result = parse(game, await request({ action: 'simulation', ...scope(game) }, signal));
  if (result.status !== 'ready') return result;
  const previous = memory.get(key(game)), latest = previous && Date.parse(previous.forecastAt!) > Date.parse(result.forecastAt!) ? previous : result;
  memory.set(key(game), latest);
  try { await storage.save(key(game), latest); }
  catch (cause) {
    console.error('Could not save NBA simulation for offline use', game.eventId, cause);
    return { ...latest, warnings: [...latest.warnings, 'Device storage could not save this NBA simulation. Keep the app open and retry with available storage.'] };
  }
  return latest;
}
function validActuals(value: unknown, forecast: NBAGameSimulation): value is NBAActuals {
  if (!value || typeof value !== 'object') return false;
  const validSide = (value: unknown, id: string) => {
    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('score' in value)
      || typeof value.score !== 'number' || !Number.isInteger(value.score) || value.score < 0
      || !('players' in value) || !value.players || typeof value.players !== 'object' || Array.isArray(value.players)) return false;
    return Object.entries(value.players).every(([id, line]: [string, unknown]) => {
      if (!/^\d{1,12}$/.test(id) || !line || typeof line !== 'object' || Array.isArray(line)) return false;
      const row = line as Record<string, unknown>;
      return ['points', 'rebounds', 'assists', 'minutes'].every(stat =>
        typeof row[stat] === 'number' && Number.isFinite(row[stat]) && row[stat] >= 0);
    });
  };
  return 'home' in value && 'away' in value && validSide(value.home, forecast.homeTeamId) && validSide(value.away, forecast.awayTeamId);
}
export async function loadNBAAccuracy(games: Game[], signal: AbortSignal): Promise<NBAAccuracyReport> {
  const value = await request({ action: 'accuracy', games: games.map(scope) }, signal);
  if (!value || typeof value !== 'object' || !('games' in value) || !Array.isArray(value.games)
    || !('issues' in value) || !Array.isArray(value.issues) || !value.issues.every(issue => typeof issue === 'string'))
    throw new Error('NBA simulation results are malformed.');
  const rows = value.games.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('eventId' in row) || !('forecast' in row)
      || !('kickoff' in row) || !('actuals' in row) || !('settledAt' in row)) throw new Error('NBA simulation result is incomplete.');
    const game = games.find(game => game.eventId === row.eventId && Date.parse(game.date) === Date.parse(String(row.kickoff)));
    if (!game) throw new Error('NBA simulation results do not match the selected slate.');
    const forecast = parse(game, row.forecast);
    if (forecast.status !== 'ready') throw new Error('NBA accuracy requires a complete archived pregame forecast.');
    if (row.actuals === null ? row.settledAt !== null : !validActuals(row.actuals, forecast)
      || typeof row.settledAt !== 'string' || !Number.isFinite(Date.parse(row.settledAt)) || Date.parse(row.settledAt) < Date.parse(game.date))
      throw new Error('NBA final results have not been verified.');
    return { eventId: game.eventId, kickoff: game.date, forecast, actuals: row.actuals as NBAActuals | null, settledAt: row.settledAt as string | null };
  });
  if (new Set(rows.map(row => row.eventId)).size !== rows.length) throw new Error('NBA results contain duplicate games.');
  return { games: rows, issues: value.issues };
}
