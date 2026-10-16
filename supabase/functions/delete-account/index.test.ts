function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('Account deletion verifies identity and password, removes uploads before hard deletion, and surfaces failures', async () => {
  const userId = 'da202222-2222-4222-8222-222222222221';
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = new Map(names.map((name) => [name, Deno.env.get(name)]));
  let handler: (request: Request) => Promise<Response> = async () => new Response('Not initialized', { status: 500 });
  let passwordValid = true;
  let tokenValid = true;
  let storageFails = false;
  let deletionFails = false;
  let remaining = 0;
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  try {
    Deno.env.set('SUPABASE_URL', 'https://example.invalid');
    Deno.env.set('SUPABASE_ANON_KEY', 'test-public-key');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: (callback: typeof handler) => { handler = callback; } });
    globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
      calls.push({ path, method: request.method, body });
      if (path.endsWith('/auth/v1/user')) return tokenValid
        ? Response.json({ id: userId, email: 'self@example.invalid' })
        : Response.json({ message: 'Expired token' }, { status: 401 });
      if (path.endsWith('/auth/v1/token')) return passwordValid
        ? Response.json({ access_token: 'verified-token', refresh_token: 'verified-refresh', expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'self@example.invalid' } })
        : Response.json({ message: 'Wrong password' }, { status: 400 });
      if (path.endsWith('/auth/v1/logout')) return new Response(null, { status: 204 });
      if (path.endsWith('/rpc/prepare_account_deletion')) return Response.json(remaining ? [{ bucket_id: 'livewire-photos', name: `${userId}/photo-${remaining}.png` }] : []);
      if (path.endsWith('/storage/v1/object/livewire-photos')) {
        if (storageFails) return Response.json({ message: 'Storage failure', statusCode: '500' }, { status: 500 });
        remaining--;
        return Response.json([{ name: 'removed' }]);
      }
      if (path.endsWith(`/auth/v1/admin/users/${userId}`)) return deletionFails
        ? Response.json({ message: 'Database deletion failed' }, { status: 500 }) : Response.json({ id: userId });
      throw new Error(`Unexpected request: ${path}`);
    };
    await import('./index.ts');
    const invoke = (body: unknown = { password: 'current-password', confirmation: 'DELETE', user_id: 'someone-else' }, authorized = true) => handler(new Request('https://example.invalid/delete-account', {
      method: 'POST', headers: authorized ? { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body),
    }));
    assert((await invoke({}, false)).status === 401 && calls.length === 0, 'Missing session must never touch data');
    tokenValid = false;
    assert((await invoke()).status === 401, 'Invalid token is refused');
    tokenValid = true;
    assert((await invoke({ password: 'current-password', confirmation: 'delete' })).status === 400, 'Explicit confirmation required');
    passwordValid = false;
    assert((await invoke()).status === 403, 'Wrong password is refused');
    assert(!calls.some(call => call.path.includes('/rpc/') || call.path.includes('/admin/')), 'No deletion side effects before reauthentication');
    passwordValid = true;
    remaining = 2;
    const success = await invoke();
    assert(success.status === 200 && (await success.json()).deleted === true, 'Successful hard deletion confirmed');
    const preparation = calls.find(call => call.path.endsWith('/prepare_account_deletion'));
    assert(preparation?.body.target_user === userId, 'Identity comes only from verified session, never supplied user ID');
    const deletion = calls.findIndex(call => call.path.includes('/admin/users/'));
    const removes = calls.map((call, index) => call.path.includes('/storage/v1/object/') ? index : -1).filter(index => index >= 0);
    assert(removes.length === 2 && removes.every(index => index < deletion), 'Every storage batch removed before account deletion');
    assert(calls[deletion].method === 'DELETE' && calls[deletion].body.should_soft_delete === false, 'User is hard deleted');
    calls.length = 0;
    remaining = 1;
    storageFails = true;
    assert((await invoke()).status === 500, 'Storage failure is explicit');
    assert(!calls.some(call => call.path.includes('/admin/users/')), 'Account survives failed storage cleanup for retry');
    storageFails = false;
    deletionFails = true;
    const failure = await invoke();
    assert(failure.status === 500 && (await failure.json()).error.includes('Please retry'), 'Final deletion failures do not report success');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(Deno, 'serve', { configurable: true, writable: true, value: originalServe });
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
