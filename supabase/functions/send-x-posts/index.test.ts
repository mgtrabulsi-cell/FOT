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
  let uploads = 0;
  let sourceReads = 0;
  let changed = false;
  let removedDuringUpload = false;
  let longAnalysis = false;
  let fourPages = false;
  let overlongCaption = false;
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
        if (url.pathname === '/2/media/upload') {
          uploads++;
          const form = await request.formData();
          const media = form.get('media');
          assert(media instanceof File && media.type === 'image/png' && media.size > 1000, 'Rendered PNG attached');
          assert(form.get('media_category') === 'tweet_image', 'Image category required');
          if (failure === 'upload') return new Response('', { status: 403 });
          if (failure === 'upload-timeout') throw new DOMException('Timed out', 'TimeoutError');
          if (failure === 'upload-invalid') return Response.json({ data: {} });
          if (failure === 'upload-processing') return Response.json({ data: { id: '777', processing_info: { state: 'pending' } } });
          return Response.json({ data: { id: String(777 + uploads) } });
        }
        if (url.pathname === '/2/media/metadata') {
          const metadata = await request.json();
          assert(typeof metadata.metadata.alt_text.text === 'string', 'Images have accessible descriptions');
          if (failure === 'metadata') return new Response('', { status: 403 });
          return Response.json({ data: { id: metadata.id } });
        }
        assert(request.method === 'POST' && url.pathname === '/2/tweets', 'Only own-account creation is allowed');
        const tweet = await request.json();
        texts.push(tweet.text);
        assert(tweet.media.media_ids.length >= 1 && tweet.media.media_ids.length <= 4, 'Tweet includes generated images');
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
      if (url.pathname.endsWith('/angles')) {
        sourceReads++;
        return Response.json(missing || (removedDuringUpload && sourceReads > 1) ? null : {
          title: overlongCaption ? 'Headline '.repeat(100) : changed && sourceReads > 1 ? 'Changed headline' : 'Original headline',
          subject: 'Player name', narrative: longAnalysis ? 'Long analysis. '.repeat(5000) : fourPages ? Array.from({ length: 90 }, () => 'Analysis line').join('\n') : 'Our editorial text.',
          evidence: '', counterpoint: '', pick: '', game_id: 'NBA:123',
          picks: [{ id: '11111111-1111-4111-8111-111111111111', text: 'Player 6+ assists', result: 'pending' }],
          status: 'published',
        });
      }
      if (url.pathname.endsWith('/livewire_posts')) {
        sourceReads++;
        return Response.json(missing || (removedDuringUpload && sourceReads > 1) ? null : {
          title: changed && sourceReads > 1 ? 'Changed headline' : 'LIVEWIRE headline',
          body: longAnalysis ? 'Long analysis. '.repeat(5000) : 'Our news.', angle_id: null,
        });
      }
      throw new Error(`Unexpected test request: ${url.pathname}`);
    };
    await import('./index.ts');
    const invoke = () => handler(new Request('https://test.invalid', { method: 'POST', headers: { 'x-gamewire-cron-secret': 'fixture' } }));
    const reset = () => { claimed = false; writes = []; texts = []; failure = ''; missing = false; account = '123'; uploads = 0; sourceReads = 0; changed = false; removedDuringUpload = false; longAnalysis = false; fourPages = false; overlongCaption = false; };
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
    assert(texts.length === 1 && texts[0].startsWith('Original headline\n\nPlayer name') && texts[0].includes('🏀 Player 6+ assists') && texts[0].includes('#analyst-desk/story/'), 'Angle keeps headline, subject, emoji picks and story URL');
    assert(!texts[0].includes('Our editorial text.') && uploads === 1, 'Analysis moves to an attached image');
    assert(writes.some(row => row.status === 'sent' && row.tweet_id === '999'), 'Accepted ID saved');
    assert((await invoke()).status === 200 && texts.length === 1, 'Claimed row cannot post twice');
    reset(); fourPages = true;
    assert((await invoke()).status === 200 && texts.length === 1 && uploads === 4, 'All four analysis images upload before one tweet');
    reset(); overlongCaption = true;
    assert((await invoke()).status === 503 && !texts.length && uploads === 0 && writes.some(row => row.status === 'failed'), 'Caption overflow never silently drops picks or uploads images');
    reset(); storyline = false;
    assert((await invoke()).status === 200 && texts[0].includes('#livewire/post/'), 'Standalone post uses LIVEWIRE URL');
    reset(); changed = true;
    assert((await invoke()).status === 503 && !texts.length && writes.some(row => row.status === 'failed'), 'Source changes during upload never send stale content');
    reset(); removedDuringUpload = true;
    assert((await invoke()).status === 200 && !texts.length && writes.some(row => row.status === 'cancelled'), 'Source removed during upload cancels tweet');
    reset(); longAnalysis = true;
    assert((await invoke()).status === 503 && !texts.length && uploads === 0 && writes.some(row => row.status === 'failed'), 'More than four images fails before upload or tweet');
    for (const mode of ['upload', 'upload-timeout', 'upload-invalid', 'upload-processing', 'metadata']) {
      reset(); failure = mode;
      assert((await invoke()).status === 503 && !texts.length && writes.some(row => row.status === 'failed'), `${mode} fails without a tweet`);
    }
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
