import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePublicFetch, isNativePublicRead, isNativePublicImage } from '../src/services/nativePolicy.ts';

const origin = 'https://fixture.supabase.co';
const scoreboard = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

test('Native live read cancellation does not wait for a suspended bridge request', async () => {
  let finish;
  const fetcher = createNativePublicFetch(assert.fail,
    () => new Promise((resolve) => { finish = resolve; }), () => {}, origin, 'capacitor://localhost/');
  const controller = new AbortController();
  const pending = fetcher(scoreboard, { cache: 'no-store', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finish({ body: '{}' });
});

test('Native offline bridge restricts reads/images to public sources', () => {
  assert.ok(isNativePublicRead(new URL(scoreboard), 'GET', origin));
  assert.ok(isNativePublicRead(new URL(`${origin}/rest/v1/livewire_posts?select=*`), 'GET', origin));
  for (const path of ['/auth/v1/token', '/rest/v1/user_favorites', '/rest/v1/livewire_roles', '/rest/v1/rpc/get_matchup_board']) {
    assert.equal(isNativePublicRead(new URL(origin + path), 'GET', origin), false);
  }
  for (const url of ['http://site.api.espn.com/data', 'https://site.api.espn.com.attacker.example/data', 'https://user:secret@site.api.espn.com/data']) {
    assert.equal(isNativePublicRead(new URL(url), 'GET', origin), false);
  }
  assert.equal(isNativePublicRead(new URL(scoreboard), 'POST', origin), false);
  assert.ok(isNativePublicImage(new URL('https://a.espncdn.com/player.png'), origin));
  assert.ok(isNativePublicImage(new URL(`${origin}/storage/v1/object/public/livewire-photos/photo.png`), origin));
  assert.ok(isNativePublicImage(new URL(`${origin}/storage/v1/render/image/public/livewire-photos/photo.png?width=640&quality=75`), origin));
  assert.equal(isNativePublicImage(new URL(`${origin}/storage/v1/render/image/private/livewire-photos/photo.png`), origin), false);
  assert.equal(isNativePublicImage(new URL(`${origin}/storage/v1/object/private/bucket/photo.png`), origin), false);
});

test('Native public bridge keeps exact queries and filters but never stores bearer tokens/cookies', async () => {
  const reads = [], messages = [];
  const fetcher = createNativePublicFetch(() => { throw Error('Unexpected browser fetch'); }, async request => {
    reads.push(request);
    return { body: '{"score":21}', savedAt: '2026-10-16T19:00:00Z' };
  }, stamp => messages.push(stamp), origin, 'capacitor://localhost/');
  const result = await fetcher(`${scoreboard}?week=6`, { headers: { Authorization: 'Bearer private-user-token', Cookie: 'private-cookie', Accept: 'application/json', 'X-Fantasy-Filter': '{"id":1}', apikey: 'not-for-espn' } });
  assert.deepEqual(reads[0], { url: `${scoreboard}?week=6`, accept: 'application/json', filter: '{"id":1}', apiKey: '' });
  assert.deepEqual(await result.json(), { score: 21 });
  assert.equal(result.headers.get('x-gamewire-saved-at'), messages[0]);
  await fetcher(`${origin}/rest/v1/matchup_boards?week=eq.6`, { headers: { apikey: 'public-key', Authorization: 'Bearer private-user-token' } });
  assert.equal(reads[1].apiKey, 'public-key');
  assert.equal(JSON.stringify(reads).includes('private-'), false);
});

test('Auth/private calls pass through with their original unread POST bodies', async () => {
  let actual;
  const fetcher = createNativePublicFetch(async request => { actual = request; return Response.json({ sent: await request.text() }); },
    () => { throw Error('Private call must not reach native store'); }, () => {}, origin, 'capacitor://localhost/');
  const request = new Request(`${origin}/auth/v1/token`, { method: 'POST', body: '{"password":"fixture"}' });
  const result = await fetcher(request);
  assert.equal(actual, request);
  assert.deepEqual(await result.json(), { sent: '{"password":"fixture"}' });
});

test('Native bridge propagates missing-copy failures and honors cancellation before and after native calls', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fetcher = createNativePublicFetch(() => { throw Error('Unexpected browser fetch'); }, async () => {
    calls++;
    throw Error('No offline copy. Reconnect.');
  }, () => {}, origin, 'capacitor://localhost/');
  await assert.rejects(fetcher(scoreboard, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(fetcher(scoreboard), /No offline copy/);
  const later = new AbortController();
  const cancelDuring = createNativePublicFetch(fetcher, async () => { later.abort(); return { body: '{}' }; }, () => {}, origin, 'capacitor://localhost/');
  await assert.rejects(cancelDuring(scoreboard, { signal: later.signal }), { name: 'AbortError' });
});

test('Native saved-first reads return immediately, refresh once, and notify only when content changes', { timeout: 2000 }, async () => {
  let record = { body: '{"yards":123}', savedAt: '2026-10-16T19:00:00Z' };
  let finish;
  let reads = 0;
  const updates = [];
  const fetcher = createNativePublicFetch(() => { throw Error('Unexpected browser fetch'); }, () => {
    reads++;
    return new Promise((resolve) => { finish = (body) => { record = { body, savedAt: record.savedAt }; resolve({ body }); }; });
  }, () => {}, origin, 'capacitor://localhost/', {
    peek: async () => record, online: () => true, updated: (url) => updates.push(url),
    error: (error) => { throw error; },
  });
  assert.deepEqual(await (await fetcher(scoreboard)).json(), { yards: 123 });
  assert.deepEqual(await (await fetcher(scoreboard)).json(), { yards: 123 });
  assert.equal(reads, 1);
  finish('{"yards":456}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [scoreboard]);
  assert.deepEqual(await (await fetcher(scoreboard)).json(), { yards: 456 });
  assert.equal(reads, 1);
});

test('Native live no-store requests wait for fresh scores, while network fallback stays explicitly marked', async () => {
  for (const cache of ['no-store', 'reload']) {
    let finish;
    const updates = [];
    const cached = [];
    const fetcher = createNativePublicFetch(() => { throw Error('Unexpected browser fetch'); },
      () => new Promise((resolve) => { finish = resolve; }), (stamp) => cached.push(stamp),
      origin, 'capacitor://localhost/', {
        peek: async () => ({ body: '{"score":7}', savedAt: '2026-10-16T19:00:00Z' }),
        online: () => true, updated: (url) => updates.push(url), error: assert.fail,
      });
    let settled = false;
    const pending = fetcher(scoreboard, { cache }).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, `${cache} must not immediately return an old saved score`);
    finish({ body: '{"score":21}' });
    const response = await pending;
    assert.deepEqual(await response.json(), { score: 21 });
    assert.equal(response.headers.has('x-gamewire-saved-at'), false);
    assert.deepEqual(updates, [], 'A fresh caller already receives the update; do not trigger a duplicate refresh');
    assert.deepEqual(cached, []);
    const fallback = fetcher(scoreboard, { cache });
    await new Promise((resolve) => setImmediate(resolve));
    finish({ body: '{"score":7}', savedAt: '2026-10-16T19:00:00Z' });
    const saved = await fallback;
    assert.deepEqual(await saved.json(), { score: 7 });
    assert.equal(saved.headers.get('x-gamewire-saved-at'), '2026-10-16T19:00:00Z');
    assert.deepEqual(cached, ['2026-10-16T19:00:00Z']);
  }
});
