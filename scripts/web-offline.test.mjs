import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebOfflineStore } from '../src/services/webOffline.ts';

function fixture() {
  const records = new Map();
  const errors = [];
  const cached = [];
  const requests = [];
  const updates = [];
  let online = true;
  let failNetwork = false;
  let failStorage = false;
  let status = 200;
  let value = 123;
  const key = (input) => typeof input === 'string' ? input : input.url;
  const caches = {
    async open(name) {
      if (!records.has(name)) records.set(name, new Map());
      const entries = records.get(name);
      return {
        async match(input) { return entries.get(key(input))?.clone(); },
        async put(input, response) {
          if (failStorage) throw new Error('Storage full');
          entries.set(key(input), response.clone());
        },
        async keys() { return [...entries.keys()].map((url) => new Request(url)); },
        async delete(input) { return entries.delete(key(input)); },
      };
    },
  };
  const options = {
    scope: 'https://gamewire.us/', publicOrigin: 'https://public-project.supabase.co',
    caches, online: () => online,
    onSaveError: (error) => errors.push(error), onSavedResponse: (timestamp) => cached.push(timestamp),
    onUpdated: (url) => updates.push(url),
    fetch: async (input) => {
      requests.push(input);
      if (!online || failNetwork) throw new Error('Airplane mode');
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('espncdn')) return new Response(new Uint8Array([137, 80, 78, 71]), { status, headers: { 'content-type': 'image/png' } });
      return Response.json({ yards: value }, { status, headers: { vary: 'Origin' } });
    },
  };
  return {
    store: () => createWebOfflineStore(options), records, errors, cached, requests, options, updates,
    offline() { online = false; },
    online() { online = true; },
    setValue(next) { value = next; },
    setStatus(next) { status = next; },
    breakNetwork() { failNetwork = true; },
    breakStorage() { failStorage = true; },
  };
}

const stats = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/123/stats?seasontype=2';
const image = 'https://a.espncdn.com/i/headshots/nfl/players/full/123.png';

test('Every public site feed retains its exact response across a cold offline launch', async () => {
  const f = fixture();
  const urls = [
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=123',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/2/schedule?season=2026',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/2/statistics?season=2026&seasontype=2',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/2/statistics?season=2026&seasontype=2&category=defensive',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/2/roster?season=2026',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=2&limit=20',
    stats,
    'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/123/gamelog?season=2026&seasontype=2',
    'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/123',
    'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info&view=mSettings&scoringPeriodId=6',
    'https://public-project.supabase.co/rest/v1/livewire_posts?select=*&order=created_at.desc&offset=0&limit=21',
    'https://public-project.supabase.co/rest/v1/matchup_boards?select=picks,revision&season=eq.2026&week=eq.6',
  ];
  const store = f.store();
  for (const [index, url] of urls.entries()) {
    f.setValue(index);
    await store.fetch(url);
  }
  f.offline();
  const cold = f.store();
  for (const [index, url] of urls.entries()) {
    assert.deepEqual(await (await cold.fetch(url)).json(), { yards: index }, url);
  }
  assert.equal(f.requests.length, urls.length);
});

test('Stats persist before service-worker control and survive cold airplane-mode launch and reconnect', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.store().fetch(stats)).json(), { yards: 123 });
  f.offline();
  const cold = await f.store().fetch(stats);
  assert.deepEqual(await cold.json(), { yards: 123 });
  assert.ok(cold.headers.get('x-gamewire-saved-at'));
  assert.equal(cold.headers.get('vary'), null);
  assert.equal(f.requests.length, 1, 'Offline reads must not wait for ESPN');
  f.online();
  f.setValue(456);
  const reconnect = f.store();
  assert.deepEqual(await (await reconnect.fetch(stats)).json(), { yards: 123 });
  await reconnect.settle();
  f.offline();
  assert.deepEqual(await (await f.store().fetch(stats)).json(), { yards: 456 });
});

test('Server errors and connectivity failures retain the last good stats; uncached data is not invented', async () => {
  const f = fixture();
  const store = f.store();
  await store.fetch(stats);
  f.setStatus(503);
  assert.deepEqual(await (await store.fetch(stats)).json(), { yards: 123 });
  f.setStatus(200);
  f.breakNetwork();
  assert.deepEqual(await (await store.fetch(stats)).json(), { yards: 123 });
  await assert.rejects(store.fetch(stats + '&unseen=1'), /Airplane mode/);
});

test('Player faces and logos persist as readable local image bytes across cold offline launches', async () => {
  const f = fixture();
  const first = await f.store().image(image);
  assert.equal(first.type, 'image/png');
  f.offline();
  const cold = await f.store().image(image);
  assert.deepEqual(new Uint8Array(await cold.arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
  assert.equal(f.requests.length, 1);
  const url = URL.createObjectURL(cold);
  try {
    assert.match(url, /^blob:/);
    assert.equal((await (await fetch(url)).blob()).size, 4);
  } finally { URL.revokeObjectURL(url); }
});

test('Public cache isolates queries and header variants without persisting credentials or private writes', async () => {
  const f = fixture();
  const store = f.store();
  const publicUrl = 'https://public-project.supabase.co/rest/v1/livewire_posts';
  await store.fetch(publicUrl, { headers: { authorization: 'secret', accept: 'application/json', 'x-fantasy-filter': 'one' } });
  await store.fetch('https://public-project.supabase.co/auth/v1/token', { method: 'POST', body: 'password' });
  await store.fetch('https://public-project.supabase.co/rest/v1/user_favorites');
  assert.equal(await store.image('https://private.example/photo.png'), null);
  for (const entries of f.records.values()) {
    assert.equal(entries.size, 1);
    assert.ok([...entries.keys()].every((key) => !key.includes('secret') && !key.includes('password')));
  }
  f.offline();
  await assert.rejects(store.fetch(publicUrl, { headers: { accept: 'application/json', 'x-fantasy-filter': 'two' } }));
  await assert.rejects(store.fetch(publicUrl + '?themes=ov.{fantasy}'));
});

test('Storage failures are explicit, keep prior saved stats, and cannot mark images saved', async () => {
  const f = fixture();
  const store = f.store();
  await store.fetch(stats);
  f.breakStorage();
  f.setValue(999);
  assert.deepEqual(await (await store.fetch(stats, { cache: 'reload' })).json(), { yards: 999 });
  await assert.rejects(store.image(image), /Storage full/);
  assert.equal(store.failures(), 2);
  assert.equal(f.errors.length, 2);
  f.offline();
  assert.deepEqual(await (await store.fetch(stats)).json(), { yards: 123 });
});

test('Cancelled public requests never masquerade as successful saved responses', async () => {
  const f = fixture();
  const store = f.store();
  await store.fetch(stats);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.fetch(stats, { signal: controller.signal }), { name: 'AbortError' });
});

test('Concurrent image consumers share one download and receive the same readable bytes', async () => {
  const f = fixture();
  const store = f.store();
  const [first, second] = await Promise.all([store.image(image), store.image(image)]);
  assert.equal(first, second);
  assert.equal(f.requests.length, 1);
});

test('Account cleanup prevents in-flight data and image downloads from recreating cleared copies', async () => {
  for (const src of [stats, image]) {
    const f = fixture();
    let finish;
    f.options.fetch = () => new Promise((resolve) => { finish = resolve; });
    const store = f.store();
    const pending = src === stats ? store.fetch(src) : store.image(src);
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    store.stop();
    finish(src === stats ? Response.json({ yards: 123 }) : new Response('pixels', { headers: { 'content-type': 'image/png' } }));
    if (src === stats) assert.equal((await pending).status, 200);
    else await assert.rejects(pending, /stopped/);
    assert.equal([...f.records.values()].reduce((count, entries) => count + entries.size, 0), 0);
  }
});

test('A missing ESPN image does not prevent later logos and faces from being saved', async () => {
  const f = fixture();
  const original = f.options.fetch;
  f.options.fetch = (input, init) => String(input).includes('missing.png')
    ? Promise.resolve(new Response('Missing', { status: 404 })) : original(input, init);
  const store = f.store();
  const urls = ['https://a.espncdn.com/missing.png', ...Array.from({ length: 9 }, (_, id) => `https://a.espncdn.com/faces/${id}.png`)];
  await assert.rejects(store.warmImages(urls, new AbortController().signal), /1 of 10/);
  f.offline();
  for (const src of urls.slice(1)) assert.equal((await f.store().image(src)).size, 4);
  assert.equal(f.requests.length, 9);
});

test('Saved stats return before a blocked refresh, deduplicate it, and notify only after changed data is saved', { timeout: 2000 }, async () => {
  const f = fixture();
  await f.store().fetch(stats);
  let finish;
  let refreshes = 0;
  f.options.fetch = () => {
    refreshes++;
    return new Promise((resolve) => { finish = resolve; });
  };
  const store = f.store();
  assert.deepEqual(await (await store.fetch(stats)).json(), { yards: 123 });
  assert.deepEqual(await (await store.fetch(stats)).json(), { yards: 123 });
  assert.equal(refreshes, 1);
  assert.deepEqual(f.updates, []);
  finish(Response.json({ yards: 456 }));
  await store.settle();
  assert.deepEqual(f.updates, [stats]);
  const refreshed = await store.fetch(stats);
  assert.equal(refreshed.headers.get('x-gamewire-revalidated'), 'true');
  assert.deepEqual(await refreshed.json(), { yards: 456 });
  assert.equal(refreshes, 1, 'Update-driven renders cannot trigger a revalidation loop');
  f.offline();
  const offline = await store.fetch(stats);
  assert.equal(offline.headers.has('x-gamewire-revalidated'), false);
  assert.deepEqual(await offline.json(), { yards: 456 });
});

test('Unchanged or failed background refreshes keep saved data without update notifications', async () => {
  const f = fixture();
  await f.store().fetch(stats);
  const unchanged = f.store();
  await unchanged.fetch(stats);
  await unchanged.settle();
  assert.deepEqual(f.updates, []);
  f.breakNetwork();
  const failed = f.store();
  assert.deepEqual(await (await failed.fetch(stats)).json(), { yards: 123 });
  await failed.settle();
  assert.equal(f.errors.length, 1);
  assert.deepEqual(f.updates, []);
  f.offline();
  assert.deepEqual(await (await f.store().fetch(stats)).json(), { yards: 123 });
});

test('Formatting-only JSON changes do not redraw the UI; invalid successful responses cannot replace saved stats', async () => {
  const f = fixture();
  await f.store().fetch(stats);
  f.options.fetch = async () => new Response('{\n  "yards": 123\n}', { headers: { 'content-type': 'application/json' } });
  const formatting = f.store();
  await formatting.fetch(stats);
  await formatting.settle();
  assert.deepEqual(f.updates, []);
  f.options.fetch = async () => new Response('<html>Upstream temporarily unavailable</html>');
  const invalid = f.store();
  await invalid.fetch(stats);
  await invalid.settle();
  assert.equal(f.errors.length, 1);
  f.offline();
  assert.deepEqual(await (await f.store().fetch(stats)).json(), { yards: 123 });
});
