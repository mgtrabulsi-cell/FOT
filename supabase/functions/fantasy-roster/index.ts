const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const teamIds = new Set(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','33','34']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', ...(status === 200 ? { 'Cache-Control': 'public, max-age=300' } : {}) },
});
export async function handleRoster(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: 'Use GET to load a roster.' }, 405);
  const url = new URL(request.url);
  const team = url.searchParams.get('team') ?? '';
  const season = url.searchParams.get('season') ?? '';
  if (!teamIds.has(team) || !/^\d{4}$/.test(season) || Number(season) < 2000 || Number(season) > 2200) {
    return json({ error: 'Choose a valid NFL team and season.' }, 400);
  }
  try {
    const upstream = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team}/roster?season=${season}`, {
      signal: AbortSignal.timeout(12_000), headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    if (!upstream.ok) {
      console.error('Fantasy roster upstream HTTP failure', team, season, upstream.status);
      return json({ error: `ESPN roster returned HTTP ${upstream.status}. Retry player search.` }, 502);
    }
    const value = await upstream.json();
    if (!value || !Array.isArray(value.athletes)) {
      console.error('Fantasy roster upstream returned an invalid roster', team, season);
      return json({ error: 'ESPN returned an invalid roster. Retry player search.' }, 502);
    }
    return json({ athletes: value.athletes });
  } catch (cause) {
    console.error('Fantasy roster upstream request failed', team, season, cause);
    return json({ error: 'ESPN roster is temporarily unavailable. Retry player search.' }, 502);
  }
}
if (import.meta.main) Deno.serve((request) => handleRoster(request));
