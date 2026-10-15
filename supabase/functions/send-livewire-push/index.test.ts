import { ApplicationServer } from 'jsr:@negrel/webpush@0.5.0';

Deno.test('LIVEWIRE dispatcher sends headline-only alerts and retries failures', async () => {
  function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const originalSubscribe = ApplicationServer.prototype.subscribe;
  const names = ['GAMEWIRE_CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_CONTACT', 'VAPID_KEYS_JSON'];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  let handler: (request: Request) => Promise<Response> = async () => new Response('Not initialized', { status: 500 });
  const payloads: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  let failPush = false;
  let subscribed = true;
  let emptyQueue = false;
  let databaseCalls = 0;
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
      if (path.endsWith('/rpc/claim_livewire_push')) {
        return Response.json(emptyQueue ? [] : [{ id: 1, post_id: 'post-123', user_id: 'user-123', endpoint: 'https://push.example.invalid/device', subject: 'Player news', attempts: 1 }]);
      }
      if (path.endsWith('/user_push_subscriptions')) return Response.json(subscribed ? { subscription: {} } : null);
      if (request.method === 'PATCH') writes.push(await request.json());
      return new Response(null, { status: 204 });
    };
    await import('./index.ts');
    const unauthorized = await handler(new Request('https://example.invalid', { method: 'POST' }));
    assert(unauthorized.status === 401 && databaseCalls === 0, 'Unauthorized requests must not access deliveries');
    const invoke = () => handler(new Request('https://example.invalid', { method: 'POST', headers: { 'x-gamewire-cron-secret': 'test-secret' } }));
    const success = await invoke();
    assert(success.status === 200, 'Delivery should succeed');
    assert(payloads.length === 1 && payloads[0].title === 'LIVEWIRE: Player news' && payloads[0].body === '', 'Alert contains only LIVEWIRE and subject');
    assert(payloads[0].url === '#livewire' && payloads[0].tag === 'gamewire-livewire-post-123', 'Alerts deep-link and deduplicate by post');
    assert(typeof writes[0].delivered_at === 'string', 'Success is persisted');
    failPush = true;
    const failure = await invoke();
    assert(failure.status === 503, 'Provider failures are surfaced');
    assert(writes.some((write) => write.last_error === 'Temporary push-provider failure' && typeof write.next_attempt_at === 'string'), 'Failures are recorded and scheduled for retry');
    subscribed = false;
    const before = payloads.length;
    assert((await invoke()).status === 200 && payloads.length === before, 'Disabled subscriptions do not receive a push');
    emptyQueue = true;
    assert((await invoke()).status === 200, 'Empty queue succeeds without a broadcast');
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
