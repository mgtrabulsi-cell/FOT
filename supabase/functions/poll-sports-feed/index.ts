import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  decideLiveFeedPoll, decideNFLDetailTargets, liveFeedQueryDates, liveFeedRequestBudget, matchESPNEventIds, nflSeasonYear,
  normalizeNBAGames, normalizeNFLGameDetails, normalizeNFLGames, normalizeNFLPlayerGames, normalizeNFLTeamGame,
  playerGamesSyncMarker, readNFLSeasonFinals, utcDay,
  type LiveFeedGameRow, type LiveFeedSport,
} from '../_shared/apiSportsFeed.ts';
import { nflTeamByAPISportsId, nflTeamMap } from '../_shared/nflTeamMap.ts';
import { matchNFLRoster } from '../_shared/nflRosterSync.ts';

async function apiSports(url: string, key: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'x-apisports-key': key, Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`API-Sports returned HTTP ${response.status}`);
  return response.json();
}

// Backfills regular-season finals into live_feed_team_games while no game is live.
// One request lists the season; one request per missing final fetches both teams' stats.
async function syncNFLSeason(admin: SupabaseClient, apiKey: string, now: Date, requestBudget: number): Promise<number> {
  const season = nflSeasonYear(now);
  const state = await admin.from('live_feed_season_state').select('finals_total,finals_synced,players_synced,updated_at')
    .eq('sport', 'NFL').eq('season', season).maybeSingle();
  if (state.error) throw state.error;
  const complete = state.data && state.data.finals_total > 0 && state.data.finals_synced >= state.data.finals_total
    && (state.data.players_synced ?? 0) >= state.data.finals_total;
  const age = state.data ? now.getTime() - Date.parse(state.data.updated_at) : Number.POSITIVE_INFINITY;
  // A completed sync only rechecks hourly for newly finished games.
  if (complete && age < 60 * 60_000) return 0;
  if (requestBudget < 2) return 0;
  let requests = 1;
  const finals = readNFLSeasonFinals(await apiSports(`https://v1.american-football.api-sports.io/games?league=1&season=${season}`, apiKey));
  const synced = await admin.from('live_feed_team_games').select('provider_game_id').eq('sport', 'NFL').eq('season', season);
  if (synced.error) throw synced.error;
  const have = new Set((synced.data ?? []).map((row) => row.provider_game_id));
  const missing = finals.filter((final) => !have.has(final.provider_game_id))
    .slice(0, Math.min(10, requestBudget - requests));
  for (const final of missing) {
    try {
      const stats = await apiSports(`https://v1.american-football.api-sports.io/games/statistics/teams?id=${final.provider_game_id}`, apiKey);
      requests++;
      const rows = normalizeNFLTeamGame(season, final, stats, (apiTeamId) => nflTeamByAPISportsId.get(apiTeamId)?.espnId ?? null);
      if (rows.length !== 2) continue;
      const saved = await admin.from('live_feed_team_games').upsert(rows, { onConflict: 'sport,provider_game_id,api_team_id' });
      if (saved.error) throw saved.error;
      have.add(final.provider_game_id);
    } catch (cause) {
      console.error(`NFL season stats sync failed for ${final.provider_game_id}`, cause);
    }
  }
  // Player game logs sync in parallel coverage: one request per final covers every player.
  const playerSynced = await admin.from('live_feed_player_games').select('provider_game_id')
    .eq('sport', 'NFL').eq('season', season).eq('api_player_id', playerGamesSyncMarker);
  if (playerSynced.error) throw playerSynced.error;
  const havePlayers = new Set((playerSynced.data ?? []).map((row) => row.provider_game_id));
  const missingPlayers = finals.filter((final) => !havePlayers.has(final.provider_game_id))
    .slice(0, Math.max(0, Math.min(10, requestBudget - requests)));
  for (const final of missingPlayers) {
    try {
      const stats = await apiSports(`https://v1.american-football.api-sports.io/games/statistics/players?id=${final.provider_game_id}`, apiKey);
      requests++;
      const rows = normalizeNFLPlayerGames(season, final, stats);
      const saved = await admin.from('live_feed_player_games').upsert(rows, { onConflict: 'sport,provider_game_id,api_player_id' });
      if (saved.error) throw saved.error;
      havePlayers.add(final.provider_game_id);
    } catch (cause) {
      console.error(`NFL player game log sync failed for ${final.provider_game_id}`, cause);
    }
  }
  const savedState = await admin.from('live_feed_season_state').upsert({
    sport: 'NFL', season, finals_total: finals.length, finals_synced: have.size, players_synced: havePlayers.size,
    updated_at: now.toISOString(),
  }, { onConflict: 'sport,season' });
  if (savedState.error) throw savedState.error;
  return requests;
}

// Refreshes up to four team roster bridges per run; each team costs one request.
// ESPN rosters come from the shared sports_resources cache, never from the browser.
async function syncNFLRosters(admin: SupabaseClient, apiKey: string, now: Date, requestBudget: number): Promise<number> {
  if (requestBudget < 1) return 0;
  const season = nflSeasonYear(now);
  const state = await admin.from('live_feed_roster_state').select('espn_team_id,synced_at').eq('sport', 'NFL').eq('season', season);
  if (state.error) throw state.error;
  const syncedAt = new Map((state.data ?? []).map((row) => [row.espn_team_id, Date.parse(row.synced_at)]));
  const stale = nflTeamMap.filter((team) => {
    const last = syncedAt.get(team.espnId);
    return last === undefined || !Number.isFinite(last) || now.getTime() - last >= 24 * 3_600_000;
  }).slice(0, Math.min(4, requestBudget));
  let requests = 0;
  for (const team of stale) {
    try {
      const resource = await admin.from('sports_resources').select('payload')
        .eq('resource_key', `football/nfl/teams/${team.espnId}/roster?season=${season}`).maybeSingle();
      if (resource.error) throw resource.error;
      if (!resource.data) continue; // The hourly ESPN roster sync has not covered this team yet.
      const players = await apiSports(`https://v1.american-football.api-sports.io/players?team=${team.apiSportsId}&season=${season}`, apiKey);
      requests++;
      const rows = matchNFLRoster(season, team.espnId, team.apiSportsId, resource.data.payload, players);
      if (!rows.length) continue;
      const syncTime = now.toISOString();
      const saved = await admin.from('live_feed_rosters')
        .upsert(rows.map((row) => ({ ...row, updated_at: syncTime })), { onConflict: 'sport,season,espn_team_id,espn_player_id' });
      if (saved.error) throw saved.error;
      const removed = await admin.from('live_feed_rosters').delete()
        .eq('sport', 'NFL').eq('season', season).eq('espn_team_id', team.espnId).lt('updated_at', syncTime);
      if (removed.error) throw removed.error;
      const savedState = await admin.from('live_feed_roster_state')
        .upsert({ sport: 'NFL', season, espn_team_id: team.espnId, synced_at: syncTime }, { onConflict: 'sport,season,espn_team_id' });
      if (savedState.error) throw savedState.error;
    } catch (cause) {
      console.error(`NFL roster sync failed for team ${team.espnId}`, cause);
    }
  }
  return requests;
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
      let seasonCount = 0;
      if (sport === 'NFL') {
        // Link rows to ESPN event IDs from the shared scoreboard so the push poller can read the feed.
        try {
          const unlinked = await admin.from('live_feed_games').select('provider_game_id,start_time,away_name,home_name')
            .eq('sport', sport).is('espn_event_id', null);
          if (unlinked.error) throw unlinked.error;
          if (unlinked.data?.length) {
            const resource = await admin.from('sports_resources').select('payload').eq('resource_key', 'football/nfl/scoreboard').maybeSingle();
            if (resource.error) throw resource.error;
            const nameToESPN = new Map(nflTeamMap.map((team) => [team.name, team.espnId]));
            const links = matchESPNEventIds(unlinked.data, resource.data?.payload, (name) => nameToESPN.get(name) ?? null);
            for (const link of links) {
              const saved = await admin.from('live_feed_games').update({ espn_event_id: link.espn_event_id })
                .eq('sport', sport).eq('provider_game_id', link.provider_game_id);
              if (saved.error) throw saved.error;
            }
          }
        } catch (cause) {
          console.error('ESPN event linking failed', cause);
        }
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
        // Season stats sync only runs outside live windows so live polling keeps priority.
        if (!unique.some((row: LiveFeedGameRow) => row.status === 'LIVE')) {
          try {
            seasonCount = await syncNFLSeason(admin, apiKey, now, liveFeedRequestBudget.NFL - used - detailCount);
          } catch (cause) {
            console.error('NFL season stats sync failed', cause);
          }
          try {
            seasonCount += await syncNFLRosters(admin, apiKey, now, liveFeedRequestBudget.NFL - used - detailCount - seasonCount);
          } catch (cause) {
            console.error('NFL roster bridge sync failed', cause);
          }
        }
      }
      const savedState = await admin.from('live_feed_state')
        .upsert({ sport, day: utcDay(now), requests_used: used + detailCount + seasonCount, last_polled_at: now.toISOString() }, { onConflict: 'sport' });
      if (savedState.error) throw savedState.error;
      const pruned = await admin.from('live_feed_games').delete().eq('sport', sport)
        .lt('start_time', new Date(now.getTime() - 3 * 86_400_000).toISOString());
      if (pruned.error) throw pruned.error;
      summary[sport] = { polled: true, games: unique.length, details: detailCount / 2, seasonRequests: seasonCount, requestsToday: used + detailCount + seasonCount };
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
