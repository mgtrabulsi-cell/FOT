import { createClient } from 'npm:@supabase/supabase-js@2';
import { object, text } from '../_shared/gamewaire.ts';
import { publicJSON } from '../_shared/gamewaireSources.ts';
import { loadNBAAccuracy, loadNBAGameSimulation, readNBASimulationScope, runNBAGameSimulation, settleNBAGameSimulations, warmNBAGameSimulations } from '../_shared/nbaSimulationBackend.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
export async function handleNBASimulation(request: Request, env: { get: (name: string) => string | undefined }, fetcher: typeof fetch = fetch) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST for NBA simulations.' }, 405);
  const cron = !!env.get('GAMEWIRE_CRON_SECRET') && request.headers.get('x-gamewire-cron-secret') === env.get('GAMEWIRE_CRON_SECRET');
  const authorization = request.headers.get('authorization');
  if (!cron && !authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to view NBA simulations.' }, 401);
  const url = env.get('SUPABASE_URL'), anon = env.get('SUPABASE_ANON_KEY'), service = env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'NBA simulation account services are not configured.' }, 503);
  try {
    let input: Record<string, unknown>;
    try { input = object(await request.json()); } catch { return json({ error: 'Invalid NBA simulation request.' }, 400); }
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const get = (url: string) => publicJSON(url, fetcher);
    if (cron) {
      if (input.action === 'warm') return json(await warmNBAGameSimulations(admin, get));
      if (input.action === 'settle') {
        const result = await settleNBAGameSimulations(admin, get);
        return json(result, result.issues.length ? 207 : 200);
      }
      if (input.action === 'run' && /^\d{1,12}$/.test(text(input.eventId))) {
        const result = await runNBAGameSimulation(admin, text(input.eventId), get);
        return json(result ? { eventId: result.eventId, stage: result.stage, progress: result.progress } : { stage: 'Worker already running' });
      }
      return json({ error: 'Invalid NBA simulation background action.' }, 400);
    }
    const client = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization! } } });
    const user = await client.auth.getUser();
    if (user.error || !user.data.user || user.data.user.is_anonymous) return json({ error: 'Sign in with an account to view NBA simulations.' }, 401);
    if (input.action === 'accuracy') {
      if (!Array.isArray(input.games) || !input.games.length || input.games.length > 64) return json({ error: 'Choose between one and 64 NBA games.' }, 400);
      let scopes;
      try { scopes = input.games.map(readNBASimulationScope); } catch (cause) { return json({ error: cause instanceof Error ? cause.message : 'Invalid NBA slate.' }, 400); }
      if (new Set(scopes.map(scope => scope.eventId)).size !== scopes.length) return json({ error: 'NBA slate must contain unique games.' }, 400);
      return json(await loadNBAAccuracy(admin, scopes));
    }
    if (input.action !== 'simulation') return json({ error: 'Choose an NBA simulation or its results.' }, 400);
    let scope;
    try { scope = readNBASimulationScope(input); } catch (cause) { return json({ error: cause instanceof Error ? cause.message : 'Invalid NBA game.' }, 400); }
    return json(await loadNBAGameSimulation(admin, scope, async () => {
      const claim = await admin.rpc('gamewire_bot_claim', { target_user: user.data.user!.id });
      if (claim.error) throw new Error('Could not check the NBA simulation request limit.');
      return claim.data === true;
    }));
  } catch (cause) {
    console.error('NBA simulation request failed', cause);
    return json({ error: cause instanceof Error ? cause.message : 'NBA simulation could not load.' }, 500);
  }
}
if (import.meta.main) Deno.serve(request => handleNBASimulation(request, Deno.env));
