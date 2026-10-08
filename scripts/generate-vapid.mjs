import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { format: 'jwk' },
  privateKeyEncoding: { format: 'jwk' },
});
const publicJwk = publicKey;
const privateJwk = privateKey;
const applicationServerKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(publicJwk.x, 'base64url'),
  Buffer.from(publicJwk.y, 'base64url'),
]).toString('base64url');
const envPath = '.env.local';
const currentEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const envLines = currentEnv.split(/\r?\n/).filter((line) => !line.startsWith('VITE_VAPID_PUBLIC_KEY='));
while (envLines.length && envLines[envLines.length - 1] === '') envLines.pop();
envLines.push(`VITE_VAPID_PUBLIC_KEY=${applicationServerKey}`);
writeFileSync(envPath, `${envLines.join('\n')}\n`, 'utf8');

const secretValues = { publicKey: publicJwk, privateKey: privateJwk };
const cronSecret = randomBytes(32).toString('base64url');
const secretFile = [
  `VAPID_KEYS_JSON='${JSON.stringify(secretValues)}'`,
  'VAPID_CONTACT=mailto:replace-with-your-support-email@example.com',
  `GAMEWIRE_CRON_SECRET=${cronSecret}`,
].join('\n');
writeFileSync('.env.push-secrets.local', `${secretFile}\n`, 'utf8');

console.log('Updated .env.local with the public VAPID key.');
console.log('Wrote private VAPID and cron values to ignored .env.push-secrets.local.');
console.log('Replace the VAPID_CONTACT placeholder before uploading secrets to Supabase.');