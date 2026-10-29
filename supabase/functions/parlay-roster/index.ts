const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown) => typeof value === 'string' ? value : '';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, ...(status === 200 ? { 'Cache-Control': 'public, max-age=300' } : {}) } });
export async function handleParlayRoster(request: Request, fetcher: typeof fetch = fetch) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return json({ error: 'Use GET to load parlay teams or players.' }, 405);
  const params = new URL(request.url).searchParams;
  const sport = params.get('sport'), team = params.get('team'), season = params.get('season');
  if (!['NBA', 'NFL'].includes(sport ?? '') || team !== null && (!/^\d{1,2}$/.test(team) || Number(team) < 1 || Number(team) > (sport === 'NBA' ? 30 : 34))
    || team !== null && (!season || !/^\d{4}$/.test(season) || Number(season) < 2000 || Number(season) > 2200)) {
    return json({ error: 'Choose a valid NBA/NFL team and season.' }, 400);
  }
  const path = sport === 'NBA' ? 'basketball/nba' : 'football/nfl';
  try {
    const upstream = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams${team ? `/${team}/roster?season=${season}` : '?limit=100'}`, {
      signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!upstream.ok) throw new Error(`ESPN returned HTTP ${upstream.status}`);
    const data = obj(await upstream.json());
    if (team) {
      if (!Array.isArray(data.athletes)) throw new Error('ESPN returned an invalid player roster');
      const players = data.athletes.flatMap((entry) => Array.isArray(obj(entry).items) ? list(obj(entry).items) : [entry])
        .map((entry) => { const player = obj(entry); return { id: str(player.id), name: str(player.displayName) || str(player.fullName),
          position: str(obj(player.position).abbreviation), image: str(obj(player.headshot).href) }; }).filter((player) => player.id && player.name);
      if (!players.length) throw new Error('No players were returned for this team');
      return json({ players });
    }
    const league = obj(list(obj(list(data.sports)[0]).leagues)[0]);
    const year = Number(obj(league.season).year ?? league.year);
    const teams = list(league.teams).map((entry) => {
      const t = obj(obj(entry).team); return { id: str(t.id), name: str(t.displayName), abbr: str(t.abbreviation),
        logo: str(obj(list(t.logos)[0]).href), color: /^[0-9a-f]{6}$/i.test(str(t.color)) ? str(t.color) : '167bcb' };
    }).filter((t) => t.id && t.name);
    if (!teams.length || !Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('ESPN returned an invalid team directory');
    return json({ teams, season: year });
  } catch (cause) {
    console.error('Parlay roster request failed', sport, team, cause);
    return json({ error: cause instanceof Error ? `${cause.message}. Retry the player picker.` : 'Player picker is unavailable. Retry.' }, 502);
  }
}
if (import.meta.main) Deno.serve((request) => handleParlayRoster(request));
