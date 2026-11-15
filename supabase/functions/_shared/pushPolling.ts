import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function withinTouchdownWait(pendingSince: string | undefined, now = Date.now()): boolean {
  if (!pendingSince) return true;
  const since = Date.parse(pendingSince);
  return Number.isFinite(since) && now - since < 20_000;
}

export async function withPushPollLease(admin: SupabaseClient, sport: 'NFL' | 'NFL_PLAYS' | 'NBA', run: () => Promise<Response>) {
  const token = crypto.randomUUID();
  const claimed = await admin.rpc('claim_score_push_poll', { target_sport: sport, target_token: token });
  if (claimed.error) throw new Error(`Could not claim ${sport} notification polling: ${claimed.error.message}`);
  if (claimed.data !== true) return Response.json({ skipped: true, reason: 'A notification poll is already running.' });
  try {
    return await run();
  } finally {
    const released = await admin.rpc('release_score_push_poll', { target_sport: sport, target_token: token });
    if (released.error) throw new Error(`Could not release ${sport} notification polling: ${released.error.message}`);
  }
}
