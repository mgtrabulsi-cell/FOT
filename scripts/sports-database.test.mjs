import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStaticSports, readSportsDatabase, sportsResourceKey } from '../src/services/sportsDatabase.ts';
import { validateSportsResource } from '../supabase/functions/_shared/sportsResources.ts';

const base = 'https://site.api.espn.com/apis/site/v2/sports/';
const config = { url: 'https://gamewire.test', key: 'public-test-key' };

test('Server rejects incomplete schedules, empty rosters and partial team directories instead of erasing good data', () => {
  const game = { id: '123', date: '2026-10-26T23:00:00Z', competitions: [{}] };
  validateSportsResource('football/nfl/scoreboard', { events: [game] });
  validateSportsResource('basketball/nba/scoreboard', { events: [] });
  assert.throws(() => validateSportsResource('football/nfl/scoreboard', { events: [] }, { events: [game] }), /erase/);
  assert.throws(() => validateSportsResource('football/nfl/scoreboard', { events: [{ id: '123' }] }), /Invalid/);
  for (const athletes of [[], [{}], [{ items: [] }]]) assert.throws(() => validateSportsResource('football/nfl/teams/1/roster', { athletes }), /roster/);
  validateSportsResource('football/nfl/teams/1/roster', { athletes: [{ items: [{ id: '1', displayName: 'Player' }] }] });
  validateSportsResource('basketball/nba/teams/1/roster', { athletes: [{ id: '1', displayName: 'Player' }] });
  const directory = (count) => ({ sports: [{ leagues: [{ teams: Array.from({ length: count }, (_, id) => ({ team: { id: String(id + 1) } })) }] }] });
  validateSportsResource('football/nfl/teams?limit=100', directory(32));
  validateSportsResource('basketball/nba/teams?limit=100', directory(30));
  assert.throws(() => validateSportsResource('football/nfl/teams?limit=100', directory(31)), /Incomplete/);
});

test('Shared resources have canonical sport/season keys and never route live boxes or private APIs through storage', () => {
  assert.equal(sportsResourceKey(`${base}football/nfl/teams/1/roster?season=2026`), 'football/nfl/teams/1/roster?season=2026');
  assert.equal(sportsResourceKey(`${base}basketball/nba/scoreboard?limit=100&dates=20261026`), 'basketball/nba/scoreboard?dates=20261026&limit=100');
  for (const url of [`${base}basketball/nba/summary?event=1`, `${base}football/nfl/teams/1/statistics`, `${base}basketball/nba/teams?token=secret`,
    'https://other.test/teams', 'https://site.api.espn.com.evil.test/apis/site/v2/sports/football/nfl/teams']) {
    assert.equal(sportsResourceKey(url), null);
  }
});

test('A brand-new device reads stored rosters without requesting the outside feed, retains timestamps and uses public-only credentials', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers.apikey, 'public-test-key');
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(new URL(url).searchParams.get('resource_key').includes('season=2026'));
    return Response.json([{ payload: { athletes: [{ id: '1' }] }, updated_at: '2026-10-26T12:00:00Z' }]);
  };
  try {
    const response = await fetchStaticSports(`${base}football/nfl/teams/1/roster?season=2026`, undefined, config);
    assert.deepEqual(await response.json(), { athletes: [{ id: '1' }] });
    assert.equal(requests.length, 1);
    assert.ok(requests[0].startsWith('https://gamewire.test/rest/v1/sports_resources?'));
    assert.equal(response.headers.get('x-gamewire-database'), 'true');
    assert.equal(response.headers.get('x-gamewire-saved-at'), String(Date.parse('2026-10-26T12:00:00Z')));
  } finally { globalThis.fetch = original; }
});

test('Missing resources fall back to the feed, database errors are explicit, and cancellation never starts another request', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    return String(url).includes('/rest/') ? Response.json([]) : Response.json({ athletes: [] });
  };
  try {
    await fetchStaticSports(`${base}basketball/nba/teams/1/roster?season=2027`, undefined, config);
    assert.equal(requests, 2);
    globalThis.fetch = async () => Response.json({ error: 'bad' }, { status: 503 });
    await assert.rejects(readSportsDatabase(`${base}football/nfl/scoreboard`, undefined, config), /HTTP 503/);
    globalThis.fetch = async () => Response.json([{ payload: null, updated_at: 'bad' }]);
    await assert.rejects(readSportsDatabase(`${base}football/nfl/scoreboard`, undefined, config), /malformed/);
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async () => { throw new Error('Must not fetch after cancellation'); };
    await assert.rejects(fetchStaticSports(`${base}football/nfl/scoreboard`, controller.signal, config), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
