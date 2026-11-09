import { handleGamewaire } from './index.ts';
import { isSoccer, markets, modelVersion, soccerModelVersion } from '../_shared/gamewaire.ts';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
for (const sport of ['NBA', 'NFL', 'EPL', 'Serie A', 'La Liga', 'Bundesliga'] as const) {
  Deno.test(`Scheduled ${sport} uses one bounded paid request and saves provider failure without publication`, async () => {
    const original = globalThis.fetch;
    const paid: URL[] = [], updates: Record<string, unknown>[] = [];
    const mock: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'api.the-odds-api.com') {
        paid.push(url);
        return Response.json({}, { status: 429, headers: { 'x-requests-last': '2', 'x-requests-remaining': '8' } });
      }
      const path = url.pathname;
      if (path.endsWith('/gamewaire_schedule_batches')) {
        const league = url.searchParams.get('sport')?.replace('eq.', '') ?? '';
        return Response.json({ id: 'batch', model_version: isSoccer(league) ? soccerModelVersion : modelVersion });
      }
      if (path.endsWith('/rpc/gamewaire_schedule_claim')) return Response.json({
        id: 'scheduled-job', sport, event_id: 'test-event', event_start: new Date(Date.now() + 86400000).toISOString(),
        matchup: 'Away @ Home', selection_note: 'Private game lean',
      });
      if (path.endsWith('/rpc/gamewaire_analysis_lock')) return Response.json('lease');
      if (path.endsWith('/rpc/gamewaire_reserve_credits')) return Response.json(true);
      if (path.endsWith('/gamewaire_schedule_jobs') && init?.method === 'PATCH') {
        updates.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }
      assert(!/publish|gamewaire_claim$/.test(path), 'Scheduled work must not publish or consume manual allowance');
      if (init?.method === 'PATCH' || init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json(null);
    };
    globalThis.fetch = mock;
    try {
      const values: Record<string, string> = {
        SUPABASE_URL: 'https://database.invalid', SUPABASE_ANON_KEY: 'test-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service', ODDS_API_KEY: 'test-key', GAMEWIRE_CRON_SECRET: 'test-cron',
      };
      const response = await handleGamewaire(new Request('https://function.invalid', {
        method: 'POST', headers: { 'x-gamewire-cron-secret': 'test-cron', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scheduled', fullAnalysis: true, settings: { markets: ['player_shots'] } }),
      }), { get: name => values[name] }, mock);
      assert(response.status >= 400, 'Provider failure must remain explicit');
      assert(paid.length === 1, 'Only one paid request per worker invocation');
      assert(paid[0].searchParams.get('markets') === (isSoccer(sport) ? 'h2h,totals' : [...markets[sport]].join(',')), 'Full NBA/NFL markets; unchanged soccer team markets');
      assert(paid[0].searchParams.get('regions') === 'us', 'Only one paid region');
      assert(updates.some(row => row.status === 'failed' && (row.provider_usage as { requestCost: number })?.requestCost === 2),
        'Failed queue outcomes and actual usage must persist');
    } finally { globalThis.fetch = original; }
  });
}
