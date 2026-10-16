import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fetchScoreboards } from '../src/services/sportsData.ts';
import { collectOfflineImages, offlineSnapshotInterval } from '../src/services/offlineSnapshots.ts';

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function fixture(scope = 'https://gamewire.us/') {
  const handlers = {};
  const stores = new Map();
  const messages = [];
  let online = true;
  let failStorage = false;
  let body = 'live data';
  let status = 200;
  const address = (key) => typeof key === 'string' ? key : key.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { return store.get(address(key))?.clone(); },
        async put(key, value) {
          if (failStorage) throw Error('Storage full');
          store.set(address(key), value.clone());
        },
        async delete(key) { return store.delete(address(key)); },
        async keys() { return [...store.keys()]; },
        async addAll(keys) { for (const key of keys) await this.put(key, new Response('shell')); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    GAMEWIRE_OFFLINE: { version: 'test', assets: ['index.html', 'assets/app.js'], publicApiOrigin: 'https://public-project.supabase.co' },
    registration: { scope },
    clients: {
      async get() { return { postMessage(value) { messages.push(value); } }; },
      async matchAll() { return [{ postMessage(value) { messages.push(value); } }]; },
      async claim() {},
    },
    async skipWaiting() {},
    addEventListener(type, callback) { handlers[type] = callback; },
  };
  vm.runInNewContext(worker, {
    self, caches, URL, Headers, Response, AbortController, AbortSignal, setTimeout, clearTimeout, console: { ...console, warn() {}, error() {} },
    fetch: async () => {
      if (!online) throw Error('Network offline');
      return new Response(body, { status });
    },
  });
  return {
    caches, stores, messages, self,
    setOnline(value) { online = value; },
    setBody(value) { body = value; },
    setStatus(value) { status = value; },
    setStorageFailure(value) { failStorage = value; },
    async lifecycle(type) {
      let pending;
      handlers[type]({ waitUntil(value) { pending = value; } });
      await pending;
    },
    async connectionStatus(id) {
      let message;
      handlers.message({ data: { type: 'GAMEWIRE_CONNECTION_STATUS' }, source: { id, postMessage(value) { message = value; } } });
      return message;
    },
    async snapshotMessage(type, data = {}) {
      let pending;
      let result;
      handlers.message({
        data: { type, ...data },
        ports: [{ postMessage(value) { result = value; } }],
        waitUntil(value) { pending = value; },
      });
      await pending;
      return result;
    },
    async warmImages(urls, failures) {
      return this.snapshotMessage('GAMEWIRE_SAVE_IMAGES', { urls, failures });
    },
    async request(url, options = {}) {
      const pending = [];
      let response;
      const request = { url, method: 'GET', mode: 'cors', destination: '', signal: new AbortController().signal, headers: new Headers(), ...options };
      handlers.fetch({ request, resultingClientId: 'offline-page', respondWith(value) { response = value; }, waitUntil(value) { pending.push(value); } });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test('Shell launches offline at both custom-domain and project paths; only owned old shells are removed', async () => {
  for (const scope of ['https://gamewire.us/', 'https://example.github.io/FOT/']) {
    const f = fixture(scope);
    await f.caches.open(`gamewire-offline:${scope}:shell:old`);
    await f.caches.open('unrelated-cache');
    await f.lifecycle('install');
    await f.lifecycle('activate');
    assert.equal(f.stores.has(`gamewire-offline:${scope}:shell:old`), false);
    assert.equal(f.stores.has('unrelated-cache'), true);
    f.setOnline(false);
    f.self.clients.get = async () => { throw Error('A navigation response must not wait for its new client to exist'); };
    assert.equal(await (await f.request(scope + '?from=home', { mode: 'navigate' })).text(), 'shell');
    assert.equal((await f.connectionStatus('offline-page')).offline, true);
    assert.equal(await (await f.request(scope + 'assets/app.js')).text(), 'shell');
    assert.equal(await f.request('https://other.example/assets/app.js'), undefined);
  }
});

test('HTTP failures never replace a good public snapshot; ESPN images can be reused offline', async () => {
  const f = fixture();
  const url = 'https://site.api.espn.com/scoreboard';
  await f.request(url);
  f.setStatus(500);
  f.setBody('upstream error');
  assert.equal(await (await f.request(url)).text(), 'live data');
  f.setStatus(200);
  f.setBody('image');
  const image = 'https://a.espncdn.com/player.png';
  await f.request(image, { destination: 'image' });
  f.setOnline(false);
  assert.equal(await (await f.request(url)).text(), 'live data');
  assert.equal(await (await f.request(image, { destination: 'image' })).text(), 'image');
});

test('Successful public reads are saved with timestamps, used offline, and refreshed online', async () => {
  const f = fixture();
  const url = 'https://public-project.supabase.co/rest/v1/livewire_posts?select=*';
  await f.request(url);
  f.setOnline(false);
  const cached = await f.request(url);
  assert.equal(await cached.text(), 'live data');
  assert.ok(cached.headers.get('x-gamewire-saved-at'));
  assert.equal(f.messages[0].type, 'GAMEWIRE_CACHED_RESPONSE');
  f.setOnline(true);
  f.setBody('updated data');
  assert.equal(await (await f.request(url)).text(), 'updated data');
  f.setOnline(false);
  assert.equal(await (await f.request(url)).text(), 'updated data');
  const missing = await f.request('https://site.api.espn.com/unseen');
  assert.equal(missing.status, 503);
  assert.match(await missing.text(), /has not been saved/);
});

test('Never intercept private data, auth, roles, RPCs, writes, or another project', async () => {
  const f = fixture();
  for (const path of ['auth/v1/token', 'rest/v1/user_favorites', 'rest/v1/livewire_roles', 'rest/v1/rpc/claim_livewire_push', 'functions/v1/send-test-push']) {
    assert.equal(await f.request(`https://public-project.supabase.co/${path}`), undefined);
  }
  assert.equal(await f.request('https://another-project.supabase.co/rest/v1/livewire_posts'), undefined);
  assert.equal(await f.request('https://public-project.supabase.co/rest/v1/livewire_posts', { method: 'POST' }), undefined);
  assert.equal(f.stores.size, 0);
});

test('Player filter headers, public theme filters, and object/list formats cannot share cached results', async () => {
  const f = fixture();
  const url = 'https://lm-api-reads.fantasy.espn.com/projections';
  await f.request(url, { headers: new Headers({ 'x-fantasy-filter': 'player-one' }) });
  const postUrl = 'https://public-project.supabase.co/rest/v1/livewire_posts';
  await f.request(postUrl, { headers: new Headers({ accept: 'application/json', authorization: 'private-session' }) });
  f.setOnline(false);
  assert.equal((await f.request(url, { headers: new Headers({ 'x-fantasy-filter': 'player-two' }) })).status, 503);
  assert.equal((await f.request(postUrl, { headers: new Headers({ accept: 'application/vnd.pgrst.object+json' }) })).status, 503);
  assert.equal((await f.request(postUrl + '?themes=ov.{fantasy}')).status, 503);
  assert.equal(await (await f.request(postUrl, { headers: new Headers({ accept: 'application/json' }) })).text(), 'live data');
  for (const store of f.stores.values()) assert.ok([...store.keys()].every((key) => !key.includes('private-session')));
});

test('Public cache is bounded and storage failures do not break online requests', async () => {
  const f = fixture();
  for (let i = 0; i < 1502; i++) await f.request(`https://site.api.espn.com/summary?id=${i}`);
  const store = f.stores.get('gamewire-offline:https://gamewire.us/:public:v1');
  assert.equal(store.size, 1500);
  assert.equal(store.has('https://site.api.espn.com/summary?id=0'), false);
  f.setStorageFailure(true);
  assert.equal(await (await f.request('https://site.api.espn.com/scoreboard')).text(), 'live data');
  assert.ok(f.messages.some((message) => message.type === 'GAMEWIRE_OFFLINE_SAVE_ERROR'));
  f.setBody('replacement');
  await f.request('https://site.api.espn.com/summary?id=1501');
  f.setOnline(false);
  assert.equal(await (await f.request('https://site.api.espn.com/summary?id=1501')).text(), 'live data');
});

test('Weekly snapshots run on a five-minute cadence and collect nested logos/faces, not arbitrary links', () => {
  assert.equal(offlineSnapshotInterval, 300_000);
  const logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png';
  const headshot = 'https://a.espncdn.com/i/headshots/nfl/players/full/123.png';
  assert.deepEqual([...collectOfflineImages({ games: [{ logo, players: [{ headshot }, { headshot }] }], url: 'https://example.com/private', headshot: 'https://example.com/private.png' })], [logo, headshot]);
});

test('Unopened team/player images are explicitly saved, survive more than 80 images, and remain available offline', async () => {
  const f = fixture();
  const urls = Array.from({ length: 150 }, (_, id) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`);
  assert.equal((await f.warmImages(urls)).saved, true);
  assert.equal(f.stores.get('gamewire-offline:https://gamewire.us/:images:v1').size, 150);
  f.setOnline(false);
  assert.equal(await (await f.request(urls[0], { destination: 'image' })).text(), 'live data');
  assert.equal(await (await f.request(urls[149], { destination: 'image' })).text(), 'live data');
});

test('Image snapshots never warm private URLs and cannot report success on download/storage failures', async () => {
  const f = fixture();
  assert.equal((await f.warmImages(['https://public-project.supabase.co/auth/v1/token'])).saved, false);
  f.setStorageFailure(true);
  assert.equal((await f.warmImages(['https://a.espncdn.com/logo.png'])).saved, false);
  f.setStorageFailure(false);
  f.setStatus(404);
  assert.equal((await f.warmImages(['https://a.espncdn.com/missing.png'])).saved, false);
});

test('Snapshot completion detects failed public saves, then permits a successful retry after storage recovers', async () => {
  const f = fixture();
  const baseline = await f.snapshotMessage('GAMEWIRE_SNAPSHOT_START');
  f.setStorageFailure(true);
  await f.request('https://site.api.espn.com/stats');
  assert.equal((await f.warmImages([], baseline.failures)).saved, false);
  f.setStorageFailure(false);
  const retry = await f.snapshotMessage('GAMEWIRE_SNAPSHOT_START');
  await f.request('https://site.api.espn.com/stats');
  assert.equal((await f.warmImages([], retry.failures)).saved, true);
});

test('Failed shell installation is not treated as a complete offline copy', async () => {
  const f = fixture();
  f.setStorageFailure(true);
  await assert.rejects(f.lifecycle('install'), /Storage full/);
  assert.equal(f.stores.has('gamewire-offline:https://gamewire.us/:shell:test'), false);
});

test('Saved scoreboards retain their recorded week instead of rolling forward to an uncached week', async (t) => {
  const requests = [];
  let saved = true;
  const payload = {
    season: { year: 2026, type: 2 }, week: { number: 1 }, events: [],
    leagues: [{ calendar: [{ value: '2', entries: [
      { value: '1', startDate: '2020-09-10T00:00:00Z' },
      { value: '2', startDate: '2020-09-17T00:00:00Z' },
    ] }] }],
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    return Response.json(payload, { headers: saved ? { 'x-gamewire-saved-at': '2026-09-10T00:00:00Z' } : {} });
  });
  const result = await fetchScoreboards(new AbortController().signal);
  assert.equal(result.nflWeek, 1);
  assert.equal(requests.length, 1);
  saved = false;
  const online = await fetchScoreboards(new AbortController().signal);
  assert.equal(online.nflWeek, 2);
  assert.equal(requests.length, 3);
  assert.match(requests[2], /week=2/);
});
