import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { xAuthorization } from '../supabase/functions/_shared/xPosting.ts';

const names = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
const file = '.env.x-secrets.local';
if (!existsSync(file)) throw new Error(`Fill in ${file} locally. Never paste tokens into chat or put them in VITE_ variables.`);
const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')]] : [];
}));
if (names.some(name => !env[name] || /\s/.test(env[name]))) throw new Error('Fill in all four X credentials with no whitespace.');
const credentials = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_TOKEN_SECRET };
const endpoint = 'https://api.x.com/2/users/me';
const response = await fetch(endpoint, {
  headers: { Authorization: await xAuthorization(credentials, 'GET', endpoint) }, signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`X account verification returned HTTP ${response.status}. Check Read and write permissions, regenerated user tokens, and API credits.`);
const account = (await response.json()).data;
if (typeof account?.id !== 'string' || !/^\d+$/.test(account.id) || typeof account.username !== 'string' || !/^\w+$/.test(account.username)) {
  throw new Error('X returned an invalid account identity.');
}
console.log(`Credentials belong to @${account.username}. No tweet has been sent.`);
const approved = process.argv.find(arg => arg.startsWith('--enable-for='))?.split('=')[1]?.replace(/^@/, '');
if (!approved) {
  console.log(`If this is the GameWire account, run: node scripts/configure-x.mjs --enable-for=${account.username}`);
  process.exit(0);
}
if (approved.toLowerCase() !== account.username.toLowerCase()) throw new Error('The confirmed account does not match these tokens. Nothing was enabled.');
const temporary = '.env.x-upload.local';
writeFileSync(temporary, [...names.map(name => `${name}=${env[name]}`), `X_ACCOUNT_ID=${account.id}`].join('\n'), { mode: 0o600 });
function cli(args) {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npx.cmd --yes supabase ${args}`], { encoding: 'utf8' })
    : spawnSync('sh', ['-c', `npx --yes supabase ${args}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Supabase configuration failed. Check CLI login and linked project; X publishing was not confirmed enabled.');
}
try {
  cli(`secrets set --env-file ${temporary}`);
  cli(`db query --linked "update public.x_publishing_settings set enabled=true where id"`);
  console.log(`X publishing enabled for @${account.username}. Only future first publications with Post to X checked will be queued.`);
} finally { unlinkSync(temporary); }
