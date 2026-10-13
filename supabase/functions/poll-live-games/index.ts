import { createClient } from 'npm:@supabase/supabase-js@2';
import { createWebPushServer, isExpiredPushSubscription, sendWebPush } from '../_shared/webpush.ts';
import { buildPlayAlerts, summaryPlayIds, type PlayFavorite } from '../_shared/plays.ts';

type TeamScore = { id: string; abbreviation: string; score: number };
type GameState = {
  status: string;
  period: number;
  clock: string;
  awayScore: number;
  homeScore: number;
  lastNotifiedAwayScore?: number;
  lastNotifiedHomeScore?: number;
  pendingPAT?: {
    pendingSince: string;
    awayScore: number;
    homeScore: number;
  } | null;
};
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
  const situation = asRecord(competition.situation);
  const lastPlay = asRecord(situation.lastPlay);

  return {
    id: stringValue(event.id),
    away,
    home,
    state: stringValue(statusType.state),
    period: Number(status.period ?? statusType.period ?? 0),
    clock: stringValue(status.displayClock ?? statusType.shortDetail),
    lastPlayText: stringValue(lastPlay.text),
  };
}

function isTouchdownPATPending(summary: unknown, lastPlayText: string, scoringDiff: number): boolean {
  if (scoringDiff !== 6 && scoringDiff !== 0) return false;

  const cleanLastPlay = (lastPlayText || '').trim();
  if (cleanLastPlay) {
    if (/extra point is (?:good|no good|missed|blocked|failed|defended)/i.test(cleanLastPlay)) return false;
    if (/two-point(?:\s+(?:pass|rush))?\s+conversion/i.test(cleanLastPlay) && /(?:attempt\s+(?:succeeds|fails)|failed|incomplete|complete)/i.test(cleanLastPlay)) return false;
    if (/\bpat\s+(?:failed|good|missed|blocked)\b/i.test(cleanLastPlay)) return false;
    if (/touchdown nullified/i.test(cleanLastPlay)) return false;
  }

  const summaryRecord = asRecord(summary);
  const scoringPlays = asArray(summaryRecord.scoringPlays).map(asRecord);
  const latestScoringPlay = scoringPlays[scoringPlays.length - 1];
  if (latestScoringPlay) {
    const spText = stringValue(latestScoringPlay.text);
    if (/\((?:[^)]*(?:kick|pat|two-point|conversion|blocked|failed|good|missed|defended)[^)]*)\)\s*$/i.test(spText)) {
      return false;
    }
  }

  const drivesRecord = asRecord(summaryRecord.drives);
  const drives = [...asArray(drivesRecord.previous), ...asArray(drivesRecord.current)].map(asRecord);
  const allPlays = drives.flatMap((d) => asArray(d.plays).map(asRecord));
  const latestDrivePlay = allPlays[allPlays.length - 1];
  if (latestDrivePlay) {
    const typeText = stringValue(asRecord(latestDrivePlay.type).text).toLowerCase();
    const pText = stringValue(latestDrivePlay.text);
    if (typeText.includes('kickoff') || /\bkicks?\b.*\bfrom\b/i.test(pText)) {
      return false;
    }
    if (/extra point is (?:good|no good|missed|blocked|failed|defended)/i.test(pText)) return false;
    if (/two-point(?:\s+(?:pass|rush))?\s+conversion/i.test(pText) && /(?:attempt\s+(?:succeeds|fails)|failed)/i.test(pText)) return false;
    if (/\bpat\s+(?:failed|good|missed|blocked)\b/i.test(pText)) return false;
  }

  return true;
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

const espnHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

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
  const summaries = new Map<string, unknown>();
  let sent = 0;
  for (const game of liveGames) {
    const summaryResponse = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(game.id)}`, {
      headers: espnHeaders,
      cache: 'no-store',
    });
    if (!summaryResponse.ok) continue;
    const summary = await summaryResponse.json();
    summaries.set(game.id, summary);
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
              title: 'Gamewire',
              body: alert.body,
              url: '/#wire',
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
  return { sent, summaries };
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
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', {
      headers: espnHeaders,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`NFL scoreboard returned HTTP ${response.status}`);
    const scoreboard = asRecord(await response.json());
    const games = asArray(scoreboard.events).map(parseEvent).filter((game): game is NonNullable<ReturnType<typeof parseEvent>> => game !== null && Boolean(game.id));
    if (games.length === 0) return Response.json({ checked: 0, sent: 0 });

    const { data: priorStates, error: stateError } = await admin.from('push_game_states')
      .select('event_id,state')
      .in('event_id', games.map((game) => game.id));
    if (stateError) throw stateError;
    const priorById = new Map((priorStates ?? []).map((row) => [row.event_id, asRecord(row.state) as unknown as GameState]));

    const liveGames = games.filter((game) => game.state === 'in');
    const { sent: playSent, summaries } = liveGames.length
      ? await sendPlayAlerts(admin, liveGames)
      : { sent: 0, summaries: new Map<string, unknown>() };

    const changedGames: typeof games = [];
    const nextStates: Array<{ event_id: string; state: Record<string, unknown>; updated_at: string }> = [];

    for (const game of games) {
      const previous = priorById.get(game.id);

      if (!previous) {
        nextStates.push({
          event_id: game.id,
          state: {
            status: game.state,
            period: game.period,
            clock: game.clock,
            awayScore: game.away.score,
            homeScore: game.home.score,
            lastNotifiedAwayScore: game.away.score,
            lastNotifiedHomeScore: game.home.score,
            pendingPAT: null,
          },
          updated_at: new Date().toISOString(),
        });
        continue;
      }

      const lastNotifiedAway = typeof previous.lastNotifiedAwayScore === 'number'
        ? previous.lastNotifiedAwayScore
        : previous.awayScore;
      const lastNotifiedHome = typeof previous.lastNotifiedHomeScore === 'number'
        ? previous.lastNotifiedHomeScore
        : previous.homeScore;

      const awayDiff = game.away.score - lastNotifiedAway;
      const homeDiff = game.home.score - lastNotifiedHome;
      const scoreChanged = awayDiff !== 0 || homeDiff !== 0;
      const becameFinal = game.state === 'post' && previous.status !== 'post';

      let isPATPending = false;
      const hadPendingPAT = Boolean(previous.pendingPAT);
      const isSixPointDiff = awayDiff === 6 || homeDiff === 6;

      if (game.state === 'in' && (isSixPointDiff || hadPendingPAT)) {
        const summary = summaries.get(game.id);
        isPATPending = isTouchdownPATPending(summary, game.lastPlayText, isSixPointDiff ? 6 : 0);

        if (isPATPending && hadPendingPAT && previous.pendingPAT?.pendingSince) {
          const pendingSince = Date.parse(previous.pendingPAT.pendingSince);
          if (Number.isFinite(pendingSince) && Date.now() - pendingSince > 180_000) {
            isPATPending = false;
          }
        }
      }

      if (isPATPending) {
        nextStates.push({
          event_id: game.id,
          state: {
            status: game.state,
            period: game.period,
            clock: game.clock,
            awayScore: game.away.score,
            homeScore: game.home.score,
            lastNotifiedAwayScore: lastNotifiedAway,
            lastNotifiedHomeScore: lastNotifiedHome,
            pendingPAT: previous.pendingPAT ?? {
              pendingSince: new Date().toISOString(),
              awayScore: game.away.score,
              homeScore: game.home.score,
            },
          },
          updated_at: new Date().toISOString(),
        });
      } else if (scoreChanged || becameFinal) {
        changedGames.push(game);
        nextStates.push({
          event_id: game.id,
          state: {
            status: game.state,
            period: game.period,
            clock: game.clock,
            awayScore: game.away.score,
            homeScore: game.home.score,
            lastNotifiedAwayScore: game.away.score,
            lastNotifiedHomeScore: game.home.score,
            pendingPAT: null,
          },
          updated_at: new Date().toISOString(),
        });
      } else {
        nextStates.push({
          event_id: game.id,
          state: {
            status: game.state,
            period: game.period,
            clock: game.clock,
            awayScore: game.away.score,
            homeScore: game.home.score,
            lastNotifiedAwayScore: lastNotifiedAway,
            lastNotifiedHomeScore: lastNotifiedHome,
            pendingPAT: null,
          },
          updated_at: new Date().toISOString(),
        });
      }
    }

    const { error: upsertError } = await admin.from('push_game_states').upsert(nextStates, { onConflict: 'event_id' });
    if (upsertError) throw upsertError;

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
      const label = game.state === 'post' ? 'Final' : 'Score update';
      const body = `${label}: ${game.away.abbreviation} ${game.away.score} - ${game.home.abbreviation} ${game.home.score} · ${periodLabel(game.period)} ${game.clock}`;

      for (const target of targets) {
        try {
          await sendWebPush(pushServer, target.subscription, {
            title: 'Gamewire',
            body,
            url: '/#wire',
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
    const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return Response.json({ error: 'Live game notifications could not be checked.', details }, { status: 500 });
  }
});