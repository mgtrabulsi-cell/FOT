import { createClient } from 'npm:@supabase/supabase-js@2';
import { createWebPushServer, isExpiredPushSubscription, sendWebPush } from '../_shared/webpush.ts';
import { buildPlayAlerts, summaryPlayIds, type PlayFavorite } from '../_shared/plays.ts';

type TeamScore = { id: string; abbreviation: string; score: number };
type GameState = { status: string; period: number; clock: string; awayScore: number; homeScore: number };
type Favorite = { type?: string; id?: string; teamId?: string; feedPath?: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function parseTeam(value: unknown): TeamScore | null {
  const competitor = asRecord(value);
  const team = asRecord(competitor.team);
  const score = Number.parseInt(stringValue(competitor.score), 10);
  const id = stringValue(team.id);
  if (!id || !Number.isFinite(score)) return null;
  return { id, abbreviation: stringValue(team.abbreviation), score };
}

function parseEvent(value: unknown) {
  const event = asRecord(value);
  const competition = asRecord(asArray(event.competitions)[0]);
  const competitors = asArray(competition.competitors).map(parseTeam).filter((team): team is TeamScore => team !== null);
  const away = competitors.find((team, index) => stringValue(asRecord(asArray(competition.competitors)[index]).homeAway) === 'away');
  const home = competitors.find((team, index) => stringValue(asRecord(asArray(competition.competitors)[index]).homeAway) === 'home');
  if (!away || !home) return null;

  const status = asRecord(competition.status ?? event.status);
  const statusType = asRecord(status.type);
  return {
    id: stringValue(event.id),
    away,
    home,
    state: stringValue(statusType.state),
    period: Number(status.period ?? statusType.period ?? 0),
    clock: stringValue(status.displayClock ?? statusType.shortDetail),
  };
}

function sameState(previous: GameState, next: GameState) {
  return previous.status === next.status
    && previous.period === next.period
    && previous.awayScore === next.awayScore
    && previous.homeScore === next.homeScore;
}

function periodLabel(period: number) {
  if (period > 0 && period <= 4) return `Q${period}`;
  if (period === 5) return 'OT';
  return period > 5 ? `OT${period - 4}` : 'Live game';
}

async function sendPlayAlerts(admin: ReturnType<typeof createClient>, liveGames: Array<{ id: string; away: TeamScore; home: TeamScore }>) {
  const playStateIds = liveGames.map((game) => `plays:${game.id}`);
  const { data: playStates, error: playStateError } = await admin.from('push_game_states').select('event_id,state').in('event_id', playStateIds);
  if (playStateError) throw playStateError;
  const seenByEvent = new Map((playStates ?? []).map((row) => [row.event_id as string, new Set(asArray(asRecord(row.state).seen).map(String))]));

  const [{ data: favoriteRows, error: favoritesError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
    admin.from('user_favorites').select('user_id,favorites'),
    admin.from('user_push_subscriptions').select('user_id,endpoint,subscription,notify_scores'),
  ]);
  if (favoritesError) throw favoritesError;
  if (subscriptionsError) throw subscriptionsError;

  const pushServer = await createWebPushServer();
  let sent = 0;
  for (const game of liveGames) {
    const summaryResponse = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(game.id)}`, { cache: 'no-store' });
    if (!summaryResponse.ok) continue;
    const summary = await summaryResponse.json();
    const allPlayIds = summaryPlayIds(summary);
    const previouslySeen = seenByEvent.get(`plays:${game.id}`);
    const newPlayIds = new Set(previouslySeen ? allPlayIds.filter((id) => !previouslySeen.has(id)) : []);
    await admin.from('push_game_states').upsert({
      event_id: `plays:${game.id}`,
      state: { seen: allPlayIds },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'event_id' });
    if (newPlayIds.size === 0) continue;

    for (const row of favoriteRows ?? []) {
      const favorites = asArray(row.favorites).map((value) => asRecord(value) as PlayFavorite & { key: string })
        .filter((favorite) => favorite.feedPath === 'football/nfl');
      const alerts = buildPlayAlerts(summary, game, favorites, newPlayIds);
      const alertsByPlay = new Map<string, (typeof alerts)[number]>();
      for (const alert of alerts) {
        const existing = alertsByPlay.get(alert.playId);
        if (!existing || (alert.isPlayerAlert && !existing.isPlayerAlert)) alertsByPlay.set(alert.playId, alert);
      }
      const targets = (subscriptions ?? []).filter((subscription) => subscription.user_id === row.user_id && subscription.notify_scores);
      for (const alert of alertsByPlay.values()) {
        for (const target of targets) {
          try {
            await sendWebPush(pushServer, target.subscription, {
              title: 'GameWire',
              body: alert.body,
              url: '/#scores',
              tag: `gamewire-play-${game.id}-${alert.playId}`,
            });
            sent += 1;
          } catch (error) {
            if (isExpiredPushSubscription(error)) {
              await admin.from('user_push_subscriptions').delete().eq('user_id', target.user_id).eq('endpoint', target.endpoint);
            }
          }
        }
      }
    }
  }
  return sent;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405 });
  const cronSecret = Deno.env.get('GAMEWIRE_CRON_SECRET');
  if (!cronSecret || request.headers.get('x-gamewire-cron-secret') !== cronSecret) {
    return new Response('Unauthorized.', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return new Response('Supabase service configuration is missing.', { status: 503 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`NFL scoreboard returned HTTP ${response.status}`);
    const scoreboard = asRecord(await response.json());
    const games = asArray(scoreboard.events).map(parseEvent).filter((game): game is NonNullable<ReturnType<typeof parseEvent>> => game !== null && Boolean(game.id));
    if (games.length === 0) return Response.json({ checked: 0, sent: 0 });

    const { data: priorStates, error: stateError } = await admin.from('push_game_states')
      .select('event_id,state')
      .in('event_id', games.map((game) => game.id));
    if (stateError) throw stateError;
    const priorById = new Map((priorStates ?? []).map((row) => [row.event_id, asRecord(row.state) as unknown as GameState]));
    const changedGames = games.filter((game) => {
      const previous = priorById.get(game.id);
      return Boolean(previous)
        && !sameState(previous!, {
          status: game.state,
          period: game.period,
          clock: game.clock,
          awayScore: game.away.score,
          homeScore: game.home.score,
        })
        && (game.state === 'in' || game.state === 'post');
    });

    const nextStates = games.map((game) => ({
      event_id: game.id,
      state: {
        status: game.state,
        period: game.period,
        clock: game.clock,
        awayScore: game.away.score,
        homeScore: game.home.score,
      },
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await admin.from('push_game_states').upsert(nextStates, { onConflict: 'event_id' });
    if (upsertError) throw upsertError;
    const liveGames = games.filter((game) => game.state === 'in');
    const playSent = liveGames.length ? await sendPlayAlerts(admin, liveGames) : 0;
    if (changedGames.length === 0) return Response.json({ checked: games.length, sent: 0, playSent });

    const [{ data: favoriteRows, error: favoritesError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
      admin.from('user_favorites').select('user_id,favorites'),
      admin.from('user_push_subscriptions').select('user_id,endpoint,subscription,notify_scores'),
    ]);
    if (favoritesError) throw favoritesError;
    if (subscriptionsError) throw subscriptionsError;

    const pushServer = await createWebPushServer();
    let sent = 0;
    for (const game of changedGames) {
      const matchingUsers = new Set((favoriteRows ?? []).filter((row) => asArray(row.favorites).some((value) => {
        const favorite = asRecord(value) as Favorite;
        if (favorite.feedPath !== 'football/nfl') return false;
        return favorite.type === 'team'
          ? favorite.id === game.away.id || favorite.id === game.home.id
          : favorite.type === 'player' && (favorite.teamId === game.away.id || favorite.teamId === game.home.id);
      })).map((row) => row.user_id));
      const targets = (subscriptions ?? []).filter((subscription) => matchingUsers.has(subscription.user_id) && subscription.notify_scores);
      const previous = priorById.get(game.id);
      const scoreChanged = previous && (previous.awayScore !== game.away.score || previous.homeScore !== game.home.score);
      const label = game.state === 'post' ? 'Final' : scoreChanged ? 'Score update' : 'Game update';
      const body = `${label}: ${game.away.abbreviation} ${game.away.score} - ${game.home.score} ${game.home.abbreviation} · ${periodLabel(game.period)} ${game.clock}`;

      for (const target of targets) {
        try {
          await sendWebPush(pushServer, target.subscription, {
            title: 'GameWire',
            body,
            url: '/#scores',
            tag: `gamewire-${game.id}`,
          });
          sent += 1;
        } catch (error) {
          if (isExpiredPushSubscription(error)) {
            await admin.from('user_push_subscriptions').delete().eq('user_id', target.user_id).eq('endpoint', target.endpoint);
          }
        }
      }
    }
    return Response.json({ checked: games.length, changed: changedGames.length, sent, playSent });
  } catch (error) {
    console.error('Live game notification poll failed.', error);
    return Response.json({ error: 'Live game notifications could not be checked.' }, { status: 500 });
  }
});