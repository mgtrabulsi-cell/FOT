export type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };

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

// Count non-ASCII code points conservatively as two; the sole URL uses X's 23-character URL weight.
export function xPostText(theme: string, title: string, body: string, link: string): string {
  const clean = (value: string) => value.replace(/https?:\/\/\S+/gi, '').replace(/\s+/gu, ' ').trim();
  const content = `${theme}: ${clean(title)}${clean(body) ? `\n\n${clean(body)}` : ''}`;
  let used = 0;
  let excerpt = '';
  const budget = 280 - 23 - 2 - 2;
  for (const character of content) {
    const weight = character.codePointAt(0)! <= 0x7f ? 1 : 2;
    if (used + weight > budget) return `${excerpt.trimEnd()}…\n\n${link}`;
    used += weight;
    excerpt += character;
  }
  return `${excerpt}\n\n${link}`;
}
