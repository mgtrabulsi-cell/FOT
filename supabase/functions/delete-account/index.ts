import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: corsHeaders });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Sign in to delete your account.' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || !serviceKey) return json({ error: 'Account deletion is not configured. Please contact support.' }, 503);
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user?.email) return json({ error: 'Your session expired. Sign in again to delete your account.' }, 401);
    let body: unknown;
    try { body = await request.json(); }
    catch { return json({ error: 'Enter your password and confirm deletion.' }, 400); }
    if (!body || typeof body !== 'object' || !('password' in body) || typeof body.password !== 'string'
      || !body.password || body.password.length > 1024 || !('confirmation' in body) || body.confirmation !== 'DELETE') {
      return json({ error: 'Enter your current password and type DELETE to confirm.' }, 400);
    }
    const verifier = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
    if (verified.error || verified.data.user?.id !== user.id) return json({ error: 'Password could not be verified. Check your current password and retry.' }, 403);
    const signedOut = await verifier.auth.signOut({ scope: 'local' });
    if (signedOut.error) throw new Error('Could not close the password-verification session.');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let uploadsRemoved = false;
    for (let batch = 0; batch < 100; batch++) {
      const prepared = await admin.rpc('prepare_account_deletion', { target_user: user.id });
      if (prepared.error) throw new Error(`Could not prepare account deletion: ${prepared.error.message}`);
      const objects: Array<{ bucket_id: string; name: string }> = prepared.data ?? [];
      if (!objects.length) { uploadsRemoved = true; break; }
      const buckets = new Map<string, string[]>();
      for (const object of objects) {
        const paths = buckets.get(object.bucket_id) ?? [];
        paths.push(object.name);
        buckets.set(object.bucket_id, paths);
      }
      for (const [bucket, paths] of buckets) {
        const removed = await admin.storage.from(bucket).remove(paths);
        if (removed.error) throw new Error(`Could not remove account uploads: ${removed.error.message}`);
      }
    }
    if (!uploadsRemoved) throw new Error('Upload cleanup needs another attempt.');
    const deleted = await admin.auth.admin.deleteUser(user.id, false);
    if (deleted.error) throw new Error(`Could not finish account deletion: ${deleted.error.message}`);
    return json({ deleted: true });
  } catch (cause) {
    console.error('Account deletion failed', cause instanceof Error ? cause.message : 'Unknown error');
    return json({ error: 'Account deletion did not finish. Some uploads may already have been removed. Please retry; your account is not deleted until this succeeds. New uploads are paused once deletion starts.' }, 500);
  }
});
