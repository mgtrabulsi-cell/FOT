import { ApplicationServer } from 'jsr:@negrel/webpush@0.5.0';

Deno.test('GamewAIre pushes are private, headline-only, linked, retried and subscription-aware', async () => {
  function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  const originalFetch = globalThis.fetch, originalServe = Deno.serve;
  const originalSubscribe = ApplicationServer.prototype.subscribe;
  const names = ['GAMEWIRE_CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_CONTACT', 'VAPID_KEYS_JSON', 'GAMEWIRE_SITE_URL'];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  let handler: (request: Request) => Promise<Response> = async () => new Response('Not initialized', { status: 500 });
  const payloads: Record<string, unknown>[] = [], writes: Record<string, unknown>[] = [];
  let databaseCalls = 0, subscribed = true, failPush = false, empty = false, expired = false, failQueue = false;
  try {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    Deno.env.set('VAPID_KEYS_JSON', JSON.stringify({
      publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey),
      privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
    }));
    Deno.env.set('VAPID_CONTACT', 'mailto:test@example.invalid');
    Deno.env.set('GAMEWIRE_CRON_SECRET', 'test-secret');
    Deno.env.set('SUPABASE_URL', 'https://example.invalid');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    Deno.env.delete('GAMEWIRE_SITE_URL');
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: (callback: typeof handler) => { handler = callback; } });
    Object.defineProperty(ApplicationServer.prototype, 'subscribe', {
      configurable: true, writable: true,
      value: () => ({
        pushTextMessage: (message: string) => {
          if (failPush) return Promise.reject(new Error('Temporary push-provider failure'));
          payloads.push(JSON.parse(message));
          return Promise.resolve();
        },
      }),
    });
    globalThis.fetch = async (input, init) => {
      databaseCalls++;
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/rpc/claim_gamewaire_push')) {
        if (failQueue) return Response.json({ message: 'Queue unavailable' }, { status: 503 });
        return Response.json(empty ? [] : [{
          id: 1, publication_date: '2026-10-28', user_id: 'user-123', endpoint: 'https://push.example.invalid/device',
          attempts: 1, expires_at: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
        }]);
      }
      if (path.endsWith('/user_push_subscriptions')) return Response.json(subscribed ? { subscription: {} } : null);
      if (request.method === 'PATCH') writes.push(await request.json());
      if (request.method === 'DELETE') writes.push({ deleted: path });
      return new Response(null, { status: 204 });
    };
    await import('./index.ts');
    assert((await handler(new Request('https://example.invalid', { method: 'POST' }))).status === 401, 'Private cron secret is required');
    assert(databaseCalls === 0, 'Unauthorized callers never read the queue');
    assert((await handler(new Request('https://example.invalid', { headers: { 'x-gamewire-cron-secret': 'test-secret' } }))).status === 405, 'Only POST dispatches');
    const invoke = () => handler(new Request('https://example.invalid', { method: 'POST', headers: { 'x-gamewire-cron-secret': 'test-secret' } }));
    assert((await invoke()).status === 200, 'Delivery succeeds');
    assert(payloads[0].title === "GamewAIre's best bets are live!" && payloads[0].body === '', 'Exact headline and no extra wording');
    assert(payloads[0].url === 'https://gamewire.us/#gamewaire', 'Tap opens GamewAIre');
    assert(payloads[0].tag === 'gamewire-gamewaire-2026-10-28', 'Retries use a stable daily notification tag');
    assert(typeof writes[0].delivered_at === 'string' && writes[0].last_error === null, 'Success is persisted');
    Deno.env.set('GAMEWIRE_SITE_URL', 'https://example.invalid/FOT/');
    await invoke();
    assert(payloads[1].url === 'https://example.invalid/FOT/#gamewaire', 'Configured deployment base paths are preserved');
    failPush = true;
    assert((await invoke()).status === 503, 'Delivery errors surface to cron');
    assert(writes.some((write) => write.last_error === 'Temporary push-provider failure' && typeof write.next_attempt_at === 'string'), 'Transient failures are recorded for retry');
    failPush = false;
    const before = payloads.length;
    subscribed = false;
    assert((await invoke()).status === 200 && payloads.length === before, 'Disabled subscriptions do not receive pushes');
    assert(writes.some((write) => write.deleted === '/rest/v1/gamewaire_push_deliveries'), 'Disabled targets are cleaned up');
    subscribed = true;
    expired = true;
    assert((await invoke()).status === 200 && payloads.length === before, 'Yesterday alerts are not delivered late');
    expired = false;
    empty = true;
    assert((await invoke()).status === 200 && payloads.length === before, 'Empty queue never broadcasts');
    empty = false;
    failQueue = true;
    assert((await invoke()).status === 500, 'Queue failures do not look like successful sends');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: originalServe });
    Object.defineProperty(ApplicationServer.prototype, 'subscribe', { configurable: true, writable: true, value: originalSubscribe });
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
