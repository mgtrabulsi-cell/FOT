import { ApplicationServer } from 'jsr:@negrel/webpush@0.5.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.test('NBA dispatcher authorizes cron, retries persisted alerts, rechecks device/favorites and isolates feed failures', async () => {
  function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
  const originalFetch = globalThis.fetch, originalServe = Deno.serve, originalSubscribe = ApplicationServer.prototype.subscribe;
  const names = ['GAMEWIRE_CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_CONTACT', 'VAPID_KEYS_JSON'];
  const oldEnv = new Map(names.map((name) => [name, Deno.env.get(name)]));
  const payloads: Record<string, unknown>[] = [], writes: Record<string, unknown>[] = [], saved: Record<string, unknown>[] = [];
  let handler: (request: Request) => Promise<Response> = async () => new Response('Not initialized');
  let queue: Record<string, unknown>[] = [], notify = true, favorite = true, failPush = false, failBoard = false, summaryFails = false;
  let dbCalls = 0;
  const event = { id: '401', date: new Date().toISOString(), competitions: [{ status: { period: 1, displayClock: '5:00', type: { state: 'in' } },
    competitors: [{ homeAway: 'away', team: { id: '1', abbreviation: 'ATL' }, score: '10' }, { homeAway: 'home', team: { id: '2', abbreviation: 'BOS' }, score: '8' }] }] };
  try {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    Deno.env.set('VAPID_KEYS_JSON', JSON.stringify({
      publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
    }));
    Deno.env.set('VAPID_CONTACT', 'mailto:test@example.invalid');
    Deno.env.set('GAMEWIRE_CRON_SECRET', 'test-secret');
    Deno.env.set('SUPABASE_URL', 'https://example.invalid');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: (callback: typeof handler) => { handler = callback; } });
    Object.defineProperty(ApplicationServer.prototype, 'subscribe', { configurable: true, writable: true, value: () => ({
      pushTextMessage(message: string) {
        if (failPush) return Promise.reject(new Error('Temporary provider error'));
        payloads.push(JSON.parse(message)); return Promise.resolve();
      },
    }) });
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/scoreboard')) return failBoard ? new Response('Unavailable', { status: 503 }) : Response.json({ events: [event] });
      if (path.endsWith('/summary')) return summaryFails ? new Response('Unavailable', { status: 503 }) : Response.json({ header: { competitions: [] } });
      dbCalls++;
      if (path.endsWith('/rpc/claim_nba_push')) { const pending = queue; queue = []; return Response.json(pending); }
      if (path.endsWith('/rpc/save_nba_push_poll')) { saved.push(await request.json()); return Response.json(true); }
      if (path.endsWith('/nba_push_states')) return Response.json([]);
      if (path.endsWith('/user_push_subscriptions')) return Response.json({ subscription: {}, notify_scores: notify });
      if (path.endsWith('/user_favorites')) return Response.json({ favorites: favorite ? [
        { feedPath: 'basketball/nba', type: 'team', id: '1' },
      ] : [{ feedPath: 'basketball/nba', type: 'player', id: 'p', teamId: '1' }, { feedPath: 'football/nfl', type: 'team', id: '1' }] });
      if (request.method === 'PATCH') writes.push(await request.json());
      return new Response(null, { status: 204 });
    };
    const mod = await import('./index.ts');
    const admin = createClient('https://example.invalid', 'test-service-key', { auth: { persistSession: false } });
    assert((await handler(new Request('https://example.invalid', { method: 'POST' }))).status === 401 && dbCalls === 0, 'Cron authorization occurs before reads');
    const delivery = { id: 1, event_id: '401', alert_key: 'points:p1:35', body: 'Test Player hits 35 points', url: 'https://gamewire.us/#wire/nba/2026-10-23/401',
      kind: 'milestone', team_ids: [], user_id: 'user', endpoint: 'https://push.example.invalid/device', attempts: 1 };
    queue = [delivery]; favorite = false;
    assert(await mod.deliverNBAPush(admin) === 1, 'League-wide milestones do not require a favorite');
    assert(payloads[0].body === delivery.body && payloads[0].url === delivery.url, 'Body and NBA deep link preserved');
    assert(payloads[0].tag === 'gamewire-nba-401-points:p1:35', 'Stable event/player/threshold tag');
    assert(typeof writes.at(-1)?.delivered_at === 'string', 'Successful delivery is durable');
    queue = [{ ...delivery, kind: 'quarter', team_ids: ['1', '2'] }];
    assert(await mod.deliverNBAPush(admin) === 0, 'Player and NFL favorites do not qualify for NBA quarter alerts');
    assert(String(writes.at(-1)?.last_error).startsWith('Cancelled:'), 'Removed favorite is explicitly cancelled');
    favorite = true; queue = [{ ...delivery, kind: 'quarter', team_ids: ['1', '2'] }];
    assert(await mod.deliverNBAPush(admin) === 1, 'NBA team favorite qualifies');
    notify = false; queue = [delivery];
    assert(await mod.deliverNBAPush(admin) === 0, 'Device score opt-out blocks all NBA highlights');
    notify = true; failPush = true; queue = [delivery];
    assert(await mod.deliverNBAPush(admin) === 0, 'Provider failure is not reported as sent');
    assert(typeof writes.at(-1)?.next_attempt_at === 'string' && !writes.at(-1)?.delivered_at, 'Failure persists retry without marking success');
    failPush = false;
    const result = await mod.pollNBA(admin);
    assert(result.checked === 1 && result.failed.length === 0, 'Repeated event across dates is deduplicated');
    assert(saved.length === 1 && Array.isArray(saved[0].alerts) && saved[0].alerts.length === 0, 'Cold start seeds state without historical pushes');
    assert(saved[0].expected_revision === 0, 'State writes use compare-and-swap revision');
    summaryFails = true;
    const broken = await mod.pollNBA(admin);
    assert(broken.failed.includes('401') && saved.length === 1, 'Failed summaries never overwrite saved state');
    failBoard = true; queue = [delivery];
    const response = await handler(new Request('https://example.invalid', { method: 'POST', headers: { 'x-gamewire-cron-secret': 'test-secret' } }));
    const outcome = await response.json();
    assert(response.status === 502 && outcome.sent === 1, 'ESPN outages surface failure but queued deliveries still run');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: originalServe });
    Object.defineProperty(ApplicationServer.prototype, 'subscribe', { configurable: true, writable: true, value: originalSubscribe });
    for (const [name, value] of oldEnv) { if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value); }
  }
});
