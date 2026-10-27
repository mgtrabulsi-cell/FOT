import { createClient } from 'npm:@supabase/supabase-js@2';
import { validateSportsResource } from '../_shared/sportsResources.ts';

const base = 'https://site.api.espn.com/apis/site/v2/sports/';
type ObjectData = Record<string, unknown>;
function object(value: unknown): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sports resource object');
  return value as ObjectData;
}
function key(path: string) {
  const url = new URL(path, base); url.searchParams.sort();
  return url.pathname.slice(new URL(base).pathname.length) + url.search;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!secret || request.headers.get('x-gamewire-cron-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'), token = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !token) return new Response('Server configuration missing', { status: 503 });
  const admin = createClient(url, token, { auth: { persistSession: false, autoRefreshToken: false } });
  const failures: string[] = [];
  const errors: Record<string, string> = {};
  let saved = 0;
  async function sync(path: string, maxAgeHours: number): Promise<ObjectData | null> {
    const resource = key(path);
    try {
      const prior = await admin.from('sports_resources').select('payload,updated_at').eq('resource_key', resource).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data && Date.parse(prior.data.updated_at) > Date.now() - maxAgeHours * 3600000) return object(prior.data.payload);
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000), headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      } });
      if (!response.ok) throw new Error(`Sports feed HTTP ${response.status}`);
      const payload = object(await response.json());
      validateSportsResource(path, payload, prior.data?.payload);
      const result = await admin.from('sports_resources').upsert({ resource_key: resource, payload, updated_at: new Date().toISOString() });
      if (result.error) throw result.error;
      saved++;
      return payload;
    } catch (error) {
      console.error('Sports resource sync failed', resource, error);
      failures.push(resource);
      errors[resource] = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
  async function batch(paths: string[], hours: number) {
    for (let i = 0; i < paths.length; i += 4) await Promise.all(paths.slice(i, i + 4).map((path) => sync(path, hours)));
  }
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const year = Number(today.slice(0, 4));
    const nflSeason = Number(today.slice(5, 7)) < 3 ? year - 1 : year;
    await sync('football/nfl/scoreboard', 0);
    const days = Array.from({ length: 38 }, (_, index) => {
      const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + index - 7);
      return `basketball/nba/scoreboard?dates=${day.toISOString().slice(0, 10).replaceAll('-', '')}&limit=100`;
    });
    await batch(days, 1);
    const nflWeeks = Array.from({ length: 18 }, (_, i) => i + 1);
    await batch(nflWeeks.flatMap((week) => [
      `football/nfl/scoreboard?week=${week}&seasontype=2`,
      `football/nfl/scoreboard?week=${week}&seasontype=2&dates=${nflSeason}`,
    ]), 6);
    for (const sport of ['football/nfl', 'basketball/nba']) {
      const teams = await sync(`${sport}/teams?limit=100`, 12);
      if (!teams) continue;
      const league = object((object((teams.sports as unknown[])[0]).leagues as unknown[])[0]);
      const season = Number(object(league.season ?? {}).year ?? league.year) || (sport === 'football/nfl' ? nflSeason : year + (Number(today.slice(5, 7)) >= 8 ? 1 : 0));
      const paths = (league.teams as unknown[]).map((entry) => {
        const id = String(object(object(entry).team).id);
        if (!/^\d+$/.test(id)) throw new Error('Invalid team ID');
        return `${sport}/teams/${id}/roster?season=${season}`;
      });
      await batch(paths, 12);
    }
    return Response.json({ saved, failures, errors }, { status: failures.length ? 502 : 200 });
  } catch (error) {
    console.error('Sports resource sync failed', error);
    return Response.json({ error: 'Sports resources could not be synchronized', saved, failures }, { status: 500 });
  }
});
