import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  decideLiveFeedPoll, decideNFLDetailTargets, liveFeedQueryDates, liveFeedRequestBudget, nflSeasonYear,
  normalizeNBAGames, normalizeNFLGameDetails, normalizeNFLGames, utcDay,
  type LiveFeedSport,
} from '../_shared/apiSportsFeed.ts';

async function apiSports(url: string, key: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'x-apisports-key': key, Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`API-Sports returned HTTP ${response.status}`);
  return response.json();
}

export async function pollSportsFeed(admin: SupabaseClient, apiKey: string, now = new Date()): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};
  for (const sport of ['NFL', 'NBA'] as LiveFeedSport[]) {
    try {
      const state = await admin.from('live_feed_state').select('day,requests_used,last_polled_at').eq('sport', sport).maybeSingle();
      if (state.error) throw state.error;
      const cached = await admin.from('live_feed_games').select('start_time,status').eq('sport', sport)
        .gte('start_time', new Date(now.getTime() - 36 * 3_600_000).toISOString());
      if (cached.error) throw cached.error;
      const decision = decideLiveFeedPoll(sport, now, state.data ?? null, cached.data ?? []);
      if (!decision.poll) {
        summary[sport] = { polled: false, reason: decision.reason };
        continue;
      }
      const dates = liveFeedQueryDates(now);
      const urls = sport === 'NFL'
        ? dates.map((date) => `https://v1.american-football.api-sports.io/games?league=1&season=${nflSeasonYear(now)}&date=${date}`)
        : dates.map((date) => `https://v2.nba.api-sports.io/games?date=${date}`);
      const payloads = await Promise.all(urls.map((url) => apiSports(url, apiKey)));
      const rows = payloads.flatMap((payload) => sport === 'NFL' ? normalizeNFLGames(payload) : normalizeNBAGames(payload));
      const unique = [...new Map(rows.map((row) => [row.provider_game_id, row])).values()];
      const fetchedAt = now.toISOString();
      if (unique.length) {
        const saved = await admin.from('live_feed_games')
          .upsert(unique.map((row) => ({ ...row, fetched_at: fetchedAt })), { onConflict: 'sport,provider_game_id' });
        if (saved.error) throw saved.error;
      }
      const used = (state.data && state.data.day === utcDay(now) ? state.data.requests_used : 0) + urls.length;
      let detailCount = 0;
      if (sport === 'NFL') {
        const details = await admin.from('live_feed_game_details').select('provider_game_id,status,fetched_at').eq('sport', sport);
        if (details.error) throw details.error;
        const budgetLeft = Math.floor((liveFeedRequestBudget.NFL - used) / 2);
        const targets = decideNFLDetailTargets(unique, details.data ?? [], now, Math.min(6, budgetLeft));
        for (const target of targets) {
          const game = unique.find((row) => row.provider_game_id === target);
          if (!game) continue;
          try {
            const [players, teams] = await Promise.all([
              apiSports(`https://v1.american-football.api-sports.io/games/statistics/players?id=${target}`, apiKey),
              apiSports(`https://v1.american-football.api-sports.io/games/statistics/teams?id=${target}`, apiKey),
            ]);
            detailCount += 2;
            const payload = normalizeNFLGameDetails(game, players, teams);
            if (!payload.away?.groups.length && !payload.home?.groups.length) continue;
            const savedDetail = await admin.from('live_feed_game_details').upsert({
              sport, provider_game_id: target, status: game.status, payload, fetched_at: now.toISOString(),
            }, { onConflict: 'sport,provider_game_id' });
            if (savedDetail.error) throw savedDetail.error;
          } catch (cause) {
            console.error(`NFL game detail poll failed for ${target}`, cause);
          }
        }
        const prunedDetails = await admin.from('live_feed_game_details').delete().eq('sport', sport)
          .lt('fetched_at', new Date(now.getTime() - 4 * 86_400_000).toISOString());
        if (prunedDetails.error) throw prunedDetails.error;
      }
      const savedState = await admin.from('live_feed_state')
        .upsert({ sport, day: utcDay(now), requests_used: used + detailCount, last_polled_at: now.toISOString() }, { onConflict: 'sport' });
      if (savedState.error) throw savedState.error;
      const pruned = await admin.from('live_feed_games').delete().eq('sport', sport)
        .lt('start_time', new Date(now.getTime() - 3 * 86_400_000).toISOString());
      if (pruned.error) throw pruned.error;
      summary[sport] = { polled: true, games: unique.length, details: detailCount / 2, requestsToday: used + detailCount };
    } catch (cause) {
      console.error(`${sport} live feed poll failed`, cause);
      summary[sport] = { polled: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  return summary;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!secret || request.headers.get('x-gamewire-cron-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return new Response('Supabase configuration is missing.', { status: 503 });
  const apiKey = Deno.env.get('API_SPORTS_KEY');
  if (!apiKey) return Response.json({ error: 'API_SPORTS_KEY is not configured in Supabase secrets.' }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    return Response.json(await pollSportsFeed(admin, apiKey));
  } catch (cause) {
    console.error('Live feed poll failed', cause);
    return Response.json({ error: 'The live sports feed could not be refreshed.' }, { status: 500 });
  }
});
