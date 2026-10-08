import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

function readEnvFile(path) {
  if (!existsSync(path)) throw new Error(`Required local file is missing: ${path}`);
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf('=');
    if (separator < 1 || line.startsWith('#')) return [];
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    return [[name, value]];
  }));
}

function quoteSql(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

const appEnv = readEnvFile('.env.local');
const serverEnv = readEnvFile('.env.push-secrets.local');
const supabaseUrl = appEnv.VITE_SUPABASE_URL?.replace(/\/$/, '');
const cronSecret = serverEnv.GAMEWIRE_CRON_SECRET;
if (!supabaseUrl || !cronSecret) throw new Error('Supabase URL or cron secret is missing from local environment files.');

const pollUrl = `${supabaseUrl}/functions/v1/poll-live-games`;
const sql = `
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  url_secret_id uuid;
  cron_secret_id uuid;
begin
  select id into url_secret_id from vault.secrets where name = 'gamewire-poll-url' limit 1;
  if url_secret_id is null then
    perform vault.create_secret(${quoteSql(pollUrl)}, 'gamewire-poll-url', 'GameWire live poll function URL', null);
  else
    perform vault.update_secret(url_secret_id, ${quoteSql(pollUrl)}, 'gamewire-poll-url', 'GameWire live poll function URL', null);
  end if;

  select id into cron_secret_id from vault.secrets where name = 'gamewire-poll-secret' limit 1;
  if cron_secret_id is null then
    perform vault.create_secret(${quoteSql(cronSecret)}, 'gamewire-poll-secret', 'GameWire scheduled poll authorization', null);
  else
    perform vault.update_secret(cron_secret_id, ${quoteSql(cronSecret)}, 'gamewire-poll-secret', 'GameWire scheduled poll authorization', null);
  end if;
end
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'gamewire-poll-live-games';
select cron.schedule(
  'gamewire-poll-live-games',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-gamewire-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gamewire-poll-secret')
      ),
      body := '{}'::jsonb
    );
  $job$
);
`;

const temporarySql = '.env.push-vault.sql';
writeFileSync(temporarySql, sql, 'utf8');
try {
  execFileSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase db query --linked --file .env.push-vault.sql --output json'], {
    stdio: 'inherit',
  });
  console.log('Vault secrets and the one-minute poll schedule are configured.');
} finally {
  unlinkSync(temporarySql);
}