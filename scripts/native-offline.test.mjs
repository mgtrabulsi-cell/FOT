import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePublicFetch, isNativePublicRead, isNativePublicImage } from '../src/services/nativePolicy.ts';

const origin = 'https://fixture.supabase.co';
const scoreboard = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

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
