import { ApplicationServer } from 'jsr:@negrel/webpush@0.5.0';

Deno.test('Angle dispatcher drops retired jobs, sends headline-only alerts and retries failures', async () => {
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
  let primaryTheme: string | null = null;
  let subject = 'Player news';
  let storyline = false;
  let published = true;
  let graphic = false;
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
        return Response.json(emptyQueue ? [] : [{ id: 1, post_id: storyline ? null : 'post-123', angle_id: storyline ? 'story-123' : null, user_id: 'user-123', endpoint: 'https://push.example.invalid/device', subject, attempts: 1, primary_theme: primaryTheme }]);
      }
      if (path.endsWith('/angles')) return Response.json(published ? { id: 'story-123', fantasy_graphic_id: graphic ? 'graphic-123' : null } : null);
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
    assert(payloads.length === 0 && writes.length === 0, 'Retired LIVEWIRE jobs never send or retry');
    storyline = true;
    await invoke();
    assert(payloads[0].title === 'News: Player news' && payloads[0].body === '', 'Alert contains only theme and subject');
    assert(payloads[0].url === 'https://mgtrabulsi-cell.github.io/FOT/#analyst-desk/story/story-123' && payloads[0].tag === 'gamewire-storyline-story-123', 'Alerts link directly to Angle');
    assert(typeof writes[0].delivered_at === 'string', 'Success is persisted');
    for (const theme of ['fantasy', 'news', 'betting']) {
      primaryTheme = theme;
      assert((await invoke()).status === 200, 'Themed delivery should succeed');
      const latest = payloads[payloads.length - 1];
      assert(latest.title === `${theme[0].toUpperCase() + theme.slice(1)}: Player news` && latest.body === '', 'First theme replaces LIVEWIRE, with no body');
      assert(latest.tag === 'gamewire-storyline-story-123', 'Themed alerts retain their story tag');
    }
    primaryTheme = 'fantasy';
    graphic = true;
    for (const week of [7, 12]) {
      for (const kind of ['Start', 'Sit']) {
        for (const position of ['QB', 'RB', 'WR', 'TE']) {
          subject = `Week ${week} Must ${kind} Fantasy ${position}`;
          assert((await invoke()).status === 200, 'Graphic notification should succeed');
          const latest = payloads[payloads.length - 1];
          assert(latest.title === `Week ${week} Must ${kind} ${position}s` && latest.body === '', 'Graphic alerts use only the compact week, kind and plural position');
          assert(latest.url === 'https://mgtrabulsi-cell.github.io/FOT/#analyst-desk/story/story-123' && latest.tag === 'gamewire-storyline-story-123', 'Graphic alerts link to Angle');
        }
      }
    }
    storyline = true;
    graphic = false;
    assert((await invoke()).status === 200, 'Storyline with a graphic-like title should succeed');
    assert(payloads[payloads.length - 1].title === `Fantasy: ${subject}`, 'Ordinary Angle headlines are not rewritten');
    subject = 'Player news';
    primaryTheme = 'betting';
    assert((await invoke()).status === 200, 'Storyline delivery succeeds');
    const story = payloads[payloads.length - 1];
    assert(story.title === 'Betting: Player news' && story.body === '', 'Storyline alert uses the first theme and no body');
    assert(story.url === 'https://mgtrabulsi-cell.github.io/FOT/#analyst-desk/story/story-123' && story.tag === 'gamewire-storyline-story-123', 'Storyline opens its own post and uses a stable tag');
    for (const theme of ['fantasy', 'news', 'betting', null]) {
      primaryTheme = theme;
      assert((await invoke()).status === 200, 'Every storyline theme dispatches');
      const prefix = theme ? theme[0].toUpperCase() + theme.slice(1) : 'News';
      assert(payloads[payloads.length - 1].title === `${prefix}: Player news`, 'Storylines use the selected theme, with News for legacy untagged deliveries');
    }
    published = false;
    const beforeUnpublished = payloads.length;
    assert((await invoke()).status === 200 && payloads.length === beforeUnpublished, 'Unpublished or deleted stories do not send');
    published = true;
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
