import { anglePicks, angleSport, readAnglePicks } from '../../../src/services/anglePicks.ts';

export type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };
export type XPostSource = {
  title: string; subject: string; analysis: string; gameId: string;
  picks: ReturnType<typeof readAnglePicks>;
};

export function xSource(row: Record<string, unknown>, angle: boolean, id: string): XPostSource {
  const text = (key: string) => {
    const value = row[key];
    if (typeof value !== 'string') throw new Error(`Published source has invalid ${key}`);
    return value;
  };
  const title = row.title === null && !angle ? 'GameWire update' : text('title');
  if (!angle) return { title, subject: '', analysis: text('body'), gameId: '', picks: [] };
  const picks = row.picks === undefined ? undefined : readAnglePicks(row.picks);
  const narrative = text('narrative');
  const evidence = text('evidence');
  const counterpoint = text('counterpoint');
  return {
    title, subject: text('subject'), gameId: text('game_id'),
    picks: anglePicks({ id, pick: text('pick'), picks }),
    analysis: [narrative, evidence.trim() ? `Evidence\n${evidence}` : '', counterpoint.trim() ? `Counterpoint\n${counterpoint}` : ''].filter(Boolean).join('\n\n'),
  };
}

export function xImagePostText(source: XPostSource, link: string): string {
  const clean = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const heading = clean(source.title);
  const subject = clean(source.subject);
  const picks = source.picks.map(pick => `${angleSport(source.gameId).emoji} ${pick.result === 'hit' ? '✅ ' : pick.result === 'miss' ? '❌ ' : ''}${clean(pick.text)}`);
  const content = [heading, ...(subject && subject !== heading ? [subject] : []), ...(picks.length ? [`Admin picks · Opinion\n${picks.join('\n')}`] : [])].join('\n\n');
  // Preserve every pick and the link. Never silently shorten an admin's selection.
  const weight = [...content.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].reduce((total, character) => total + (character.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
  if (weight + 2 + 23 > 280) throw new Error('Headline, subject and admin picks exceed X’s 280-character limit. Shorten them or post manually; no tweet was sent.');
  return `${content}\n\n${link}`;
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export async function xAuthorization(
  credentials: XCredentials, method: string, address: string,
  nonce = crypto.randomUUID().replace(/-/g, ''), timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<string> {
  const url = new URL(address);
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp, oauth_token: credentials.accessToken, oauth_version: '1.0',
  };
  const parameters = [...url.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('&');
  const base = [method.toUpperCase(), `${url.origin}${url.pathname}`, parameters].map(encode).join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${encode(credentials.apiSecret)}&${encode(credentials.accessSecret)}`),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  oauth.oauth_signature = btoa(String.fromCharCode(...signature));
  return `OAuth ${Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(', ')}`;
}
