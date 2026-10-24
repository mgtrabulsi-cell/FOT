import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createWebPushServer, isExpiredPushSubscription, sendWebPush } from '../_shared/webpush.ts';
import { buildNBAAlerts, nbaDate, nbaNotificationHash, nbaRecord, parseNBAPushGame, type NBAAlertState } from '../_shared/nbaAlerts.ts';

const espnBase = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
async function espn(path: string): Promise<unknown> {
  const response = await fetch(`${espnBase}/${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`NBA ${path} returned HTTP ${response.status}`);
  return response.json();
}
function teamFavorite(favorites: unknown, teamIds: string[]): boolean {
  return Array.isArray(favorites) && favorites.some((value) => {
    const favorite = nbaRecord(value);
    return favorite.feedPath === 'basketball/nba' && favorite.type === 'team' && teamIds.includes(String(favorite.id));
  });
}

export async function deliverNBAPush(admin: SupabaseClient): Promise<number> {
  const claimed = await admin.rpc('claim_nba_push');
  if (claimed.error) throw claimed.error;
  if (!claimed.data?.length) return 0;
  const server = await createWebPushServer();
  let sent = 0;
  for (const delivery of claimed.data) {
    const subscription = await admin.from('user_push_subscriptions').select('subscription,notify_scores')
      .eq('user_id', delivery.user_id).eq('endpoint', delivery.endpoint).maybeSingle();
    if (subscription.error) throw subscription.error;
    let allowed = subscription.data?.notify_scores === true;
    if (allowed && delivery.kind === 'quarter') {
      const favorites = await admin.from('user_favorites').select('favorites').eq('user_id', delivery.user_id).maybeSingle();
      if (favorites.error) throw favorites.error;
      allowed = teamFavorite(favorites.data?.favorites, delivery.team_ids);
    }
    if (!allowed) {
      const cancelled = await admin.from('nba_push_deliveries').update({ delivered_at: new Date().toISOString(), last_error: 'Cancelled: device preference or team favorite removed.' }).eq('id', delivery.id);
      if (cancelled.error) throw cancelled.error;
      continue;
    }
    try {
      await sendWebPush(server, subscription.data!.subscription, {
        title: 'GameWire NBA', body: delivery.body, url: delivery.url,
        tag: `gamewire-nba-${delivery.event_id}-${delivery.alert_key}`,
      });
    } catch (cause) {
      console.error('NBA push delivery failed', delivery.id, cause);
      if (isExpiredPushSubscription(cause)) {
        const removed = await admin.from('user_push_subscriptions').delete().eq('user_id', delivery.user_id).eq('endpoint', delivery.endpoint);
        if (removed.error) throw removed.error;
      } else {
        const retry = await admin.from('nba_push_deliveries').update({
          last_error: cause instanceof Error ? cause.message : String(cause),
          next_attempt_at: new Date(Date.now() + Math.min(10, 2 ** Math.min(delivery.attempts, 4)) * 60000).toISOString(),
        }).eq('id', delivery.id);
        if (retry.error) throw retry.error;
      }
      continue;
    }
    const saved = await admin.from('nba_push_deliveries').update({ delivered_at: new Date().toISOString(), last_error: null }).eq('id', delivery.id);
    if (saved.error) throw saved.error;
    sent++;
  }
  return sent;
}

export async function pollNBA(admin: SupabaseClient): Promise<{ checked: number; failed: string[] }> {
  // Yesterday covers late West Coast games and final-stat corrections after Eastern midnight.
  const today = nbaDate();
  const dates = [today, nbaDate(new Date(Date.parse(`${today}T12:00:00Z`) - 86400000))];
  const events = new Map<string, unknown>();
  const failed: string[] = [];
  for (const date of dates) {
    try {
      const scoreboard = nbaRecord(await espn(`scoreboard?dates=${date.replaceAll('-', '')}`));
      if (!Array.isArray(scoreboard.events)) throw new Error('NBA scoreboard is missing events.');
      for (const event of scoreboard.events) {
        const id = nbaRecord(event).id;
        if (typeof id === 'string' && /^\d+$/.test(id)) events.set(id, event);
      }
    } catch (cause) { console.error('NBA scoreboard poll failed', date, cause); failed.push(date); }
  }
  const prior = await admin.from('nba_push_states').select('event_id,revision,state');
  if (prior.error) throw prior.error;
  const states = new Map<string, { revision: number; state: NBAAlertState }>((prior.data ?? []).map((row) => [row.event_id, row]));
  const games = [...events.entries()];
  for (let offset = 0; offset < games.length; offset += 3) {
    await Promise.all(games.slice(offset, offset + 3).map(async ([id, event]) => {
      try {
        const raw = nbaRecord(event), competition = nbaRecord(Array.isArray(raw.competitions) ? raw.competitions[0] : null);
        const status = nbaRecord(nbaRecord(competition.status ?? raw.status).type);
        const previous = states.get(id);
        if (status.state === 'pre') {
          if (previous) return;
        } else if (status.state === 'post' && previous?.state.status === 'post' && Date.now() - Date.parse(String(raw.date)) > 8 * 3600000) return;
        const summary = status.state === 'pre' ? null : await espn(`summary?event=${id}`);
        if (status.state !== 'pre' && !nbaRecord(summary).header) throw new Error('NBA summary has no header.');
        const game = parseNBAPushGame(event, summary);
        const { state, alerts } = buildNBAAlerts(game, previous?.state ?? null);
        const saved = await admin.rpc('save_nba_push_poll', {
          game_id: id, expected_revision: previous?.revision ?? 0, next_state: state, alerts,
          game_url: new URL(nbaNotificationHash(id, nbaDate(new Date(game.date))), Deno.env.get('GAMEWIRE_SITE_URL') ?? 'https://gamewire.us/').href,
        });
        if (saved.error) throw saved.error;
        if (saved.data !== true) console.warn('NBA poll raced with a newer observation; next poll will retry', id);
      } catch (cause) { console.error('NBA game poll failed', id, cause); failed.push(id); }
    }));
  }
  return { checked: events.size, failed };
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!secret || request.headers.get('x-gamewire-cron-secret') !== secret) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response('Supabase configuration is missing.', { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // Deliver persisted retries even when ESPN is temporarily unavailable.
    const retried = await deliverNBAPush(admin);
    const result = await pollNBA(admin);
    const sent = await deliverNBAPush(admin);
    return Response.json({ ...result, sent: sent + retried }, { status: result.failed.length ? 502 : 200 });
  } catch (cause) {
    console.error('NBA notification poll failed', cause);
    return Response.json({ error: 'NBA notifications could not be checked.' }, { status: 500 });
  }
});
