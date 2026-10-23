import { handleRoster } from './index.ts';
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
Deno.test('Public roster proxy validates routes, methods, and CORS without arbitrary upstream access', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    assert(String(input) === 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/9/roster?season=2026', 'Unexpected upstream route');
    return Response.json({ athletes: [{ items: [{ id: '4036378' }] }], private: 'not forwarded' });
  };
  for (const query of ['team=https://example.com&season=2026', 'team=99&season=2026', 'team=9&season=abc', 'team=9&season=2300']) {
    assert((await handleRoster(new Request(`https://fixture/?${query}`), fetcher)).status === 400, 'Invalid route accepted');
  }
  assert(calls === 0, 'Invalid request fetched upstream');
  const preflight = await handleRoster(new Request('https://fixture/', { method: 'OPTIONS' }), fetcher);
  assert(preflight.status === 204 && preflight.headers.get('Access-Control-Allow-Origin') === '*', 'Missing CORS');
  assert((await handleRoster(new Request('https://fixture/', { method: 'POST' }), fetcher)).status === 405, 'Write method accepted');
  const result = await handleRoster(new Request('https://fixture/?team=9&season=2026'), fetcher);
  const body = await result.json();
  assert(result.status === 200 && body.athletes.length === 1 && !('private' in body), 'Invalid public response');
  assert(result.headers.get('Cache-Control')?.includes('max-age=300'), 'Missing cache limit');
});
Deno.test('Roster proxy reports upstream outages and malformed feeds explicitly', async () => {
  const error = console.error;
  const logs: unknown[][] = [];
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    for (const fetcher of [
      async () => new Response('outage', { status: 503 }),
      async () => Response.json({}),
      async () => { throw new Error('timeout'); },
    ]) {
      const result = await handleRoster(new Request('https://fixture/?team=9&season=2026'), fetcher);
      assert(result.status === 502 && (await result.json()).error, 'Failure did not surface');
    }
    assert(logs.length === 3, 'Failures were not logged');
  } finally { console.error = error; }
});
