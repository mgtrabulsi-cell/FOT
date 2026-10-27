const apiPrefix = 'https://site.api.espn.com/apis/site/v2/sports/';
type Config = { url: string; key: string };
const env = import.meta.env;
const configured = env?.VITE_SUPABASE_URL && (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)
  ? { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY } : null;

export function sportsResourceKey(url: string): string | null {
  if (!url.startsWith(apiPrefix)) return null;
  const parsed = new URL(url);
  const path = parsed.pathname.slice(new URL(apiPrefix).pathname.length);
  if (!/^(football\/nfl|basketball\/nba)\/(scoreboard|teams(?:\/\d+\/roster)?)$/.test(path)) return null;
  if ([...parsed.searchParams.keys()].some((key) => !['dates', 'week', 'season', 'seasontype', 'limit'].includes(key))) return null;
  parsed.searchParams.sort();
  return `${path}${parsed.search ? `?${parsed.searchParams}` : ''}`;
}

export async function readSportsDatabase(url: string, signal?: AbortSignal, config: Config | null = configured): Promise<Response | null> {
  const resource = sportsResourceKey(url);
  if (!config || !resource) return null;
  signal?.throwIfAborted();
  const query = new URLSearchParams({ resource_key: `eq.${resource}`, select: 'payload,updated_at', limit: '1' });
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/sports_resources?${query}`, {
    headers: { apikey: config.key, Accept: 'application/json' },
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]),
  });
  if (!response.ok) throw new Error(`Saved sports data returned HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Saved sports data returned an invalid response.');
  if (!rows.length) return null;
  const row = rows[0];
  if (!row || typeof row.payload !== 'object' || row.payload === null || typeof row.updated_at !== 'string'
    || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('Saved sports data is malformed.');
  return Response.json(row.payload, { headers: { 'x-gamewire-saved-at': String(Date.parse(row.updated_at)), 'x-gamewire-database': 'true' } });
}

export async function fetchStaticSports(url: string, signal?: AbortSignal, config: Config | null = configured): Promise<Response> {
  try {
    const stored = await readSportsDatabase(url, signal, config);
    if (stored) return stored;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error('Could not read shared sports data; trying the data feed', error);
  }
  return fetch(url, { signal, cache: 'no-store' });
}
