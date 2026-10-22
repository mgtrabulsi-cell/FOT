function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

Deno.test('X dispatcher checks account, sends once, reports failures, and never retries ambiguous sends', async () => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const names = ['GAMEWIRE_CRON_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET','X_ACCOUNT_ID'];
  const previous = new Map(names.map(name => [name, Deno.env.get(name)]));
  let handler: (request: Request) => Promise<Response> = async () => new Response('', { status: 500 });
  let enabled = true;
  let pending = true;
  let claimed = false;
  let missing = false;
  let storyline = true;
  let account = '123';
  let failure = '';
  let writes: Record<string, unknown>[] = [];
  let texts: string[] = [];
  let calls = 0;
  let xCalls = 0;
  try {
    for (const name of names) Deno.env.set(name, name === 'SUPABASE_URL' ? 'https://test.invalid' : name === 'X_ACCOUNT_ID' ? '123' : 'fixture');
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: (callback: typeof handler) => { handler = callback; } });
    globalThis.fetch = async (input, init) => {
      calls++;
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === 'api.x.com') {
        xCalls++;
        assert(request.headers.get('authorization')?.startsWith('OAuth '), 'User-context OAuth required');
        if (url.pathname === '/2/users/me') return Response.json({ data: { id: account, username: 'GameWireFixture' } });
        assert(request.method === 'POST' && url.pathname === '/2/tweets', 'Only own-account creation is allowed');
        texts.push((await request.json()).text);
        if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
        if (failure === '403') return new Response('', { status: 403 });
        if (failure === '500') return new Response('', { status: 500 });
        if (failure === 'invalid') return Response.json({ data: {} });
        return Response.json({ data: { id: '999' } });
      }
      if (url.pathname.endsWith('/x_publishing_settings')) return Response.json({ enabled });
      if (url.pathname.endsWith('/rpc/claim_x_publications')) {
        if (claimed) return Response.json([]);
        claimed = true;
        return Response.json([{ id: 1, source_type: storyline ? 'angle' : 'livewire', source_id: '11111111-1111-4111-8111-111111111111' }]);
      }
      if (url.pathname.endsWith('/x_publications')) {
        if (request.method === 'PATCH') { writes.push(await request.json()); return new Response(null, { status: 204 }); }
        return Response.json(pending ? [{ id: 1 }] : []);
      }
      if (url.pathname.endsWith('/angles')) return Response.json(missing ? null : { title: 'Original headline', narrative: 'Our editorial text.', status: 'published', themes: ['fantasy'] });
      if (url.pathname.endsWith('/livewire_posts')) return Response.json(missing ? null : { title: 'LIVEWIRE headline', body: 'Our news.', angle_id: null, themes: ['news'] });
      throw new Error(`Unexpected test request: ${url.pathname}`);
    };
    await import('./index.ts');
    const invoke = () => handler(new Request('https://test.invalid', { method: 'POST', headers: { 'x-gamewire-cron-secret': 'fixture' } }));
    const reset = () => { claimed = false; writes = []; texts = []; failure = ''; missing = false; account = '123'; };
    assert((await handler(new Request('https://test.invalid', { method: 'POST' }))).status === 401 && calls === 0, 'Unauthorized calls cannot read queues');
    assert((await handler(new Request('https://test.invalid', { headers: { 'x-gamewire-cron-secret': 'fixture' } }))).status === 405, 'GET cannot dispatch');
    enabled = false;
    assert((await invoke()).status === 200 && xCalls === 0 && !claimed, 'Disabled integration makes no X requests');
    enabled = true; pending = false;
    assert((await invoke()).status === 200 && xCalls === 0 && !claimed, 'Empty queue makes no billed X requests');
    pending = true;
    account = 'wrong-account';
    assert((await invoke()).status === 503 && !claimed && !texts.length, 'Account mismatch cannot claim or post');
    reset();
    assert((await invoke()).status === 200, 'Successful send');
    assert(texts.length === 1 && texts[0].startsWith('Fantasy: Original headline') && texts[0].includes('#analyst-desk/story/'), 'Angle uses theme, excerpt and story URL');
    assert(writes.some(row => row.status === 'sent' && row.tweet_id === '999'), 'Accepted ID saved');
    assert((await invoke()).status === 200 && texts.length === 1, 'Claimed row cannot post twice');
    reset(); storyline = false;
    assert((await invoke()).status === 200 && texts[0].includes('#livewire/post/'), 'Standalone post uses LIVEWIRE URL');
    reset(); missing = true;
    assert((await invoke()).status === 200 && texts.length === 0 && writes.some(row => row.status === 'cancelled'), 'Removed or unpublished sources do not send');
    for (const [mode, expected] of [['403','failed'],['500','unknown'],['timeout','unknown'],['invalid','unknown']]) {
      reset(); failure = mode;
      assert((await invoke()).status === 503, `${mode} is reported explicitly`);
      assert(writes.some(row => row.status === expected), `${mode} becomes ${expected}`);
      await invoke();
      assert(texts.length === 1, 'Failures and ambiguous sends never auto-repost');
    }
    reset(); Deno.env.delete('X_ACCESS_TOKEN');
    assert((await invoke()).status === 503 && !claimed && texts.length === 0, 'Missing credentials cannot claim a delivery');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: originalServe });
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
    }
  }
});
