import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { xAuthorization, xPostText } from '../supabase/functions/_shared/xPosting.ts';

test('OAuth 1.0a signature includes query parameters and token secrets, not the JSON body', async () => {
  const credentials = { apiKey: 'key!', apiSecret: 'secret&', accessToken: 'token', accessSecret: 'access/' };
  const header = await xAuthorization(credentials, 'GET', 'https://api.x.com/2/users/me?user.fields=id', 'nonce', '12345');
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const normalized = [
    ['oauth_consumer_key', 'key!'], ['oauth_nonce', 'nonce'], ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', '12345'], ['oauth_token', 'token'], ['oauth_version', '1.0'], ['user.fields', 'id'],
  ].map(([key,value]) => `${encode(key)}=${encode(value)}`).join('&');
  const signature = createHmac('sha1', `${encode('secret&')}&${encode('access/')}`)
    .update(['GET', 'https://api.x.com/2/users/me', normalized].map(encode).join('&')).digest('base64');
  assert.ok(header.includes(`oauth_signature="${encode(signature)}"`));
  assert.ok(!header.includes('secret'));
  const post = await xAuthorization(credentials, 'POST', 'https://api.x.com/2/tweets', 'nonce', '12345');
  assert.notEqual(post, header);
});

test('Tweet text includes one canonical GameWire link, readable prefix, and stays under weighted limits', () => {
  const link = 'https://gamewire.us/#analyst-desk/story/11111111-1111-4111-8111-111111111111';
  for (const body of ['', 'Short text.', 'a '.repeat(5000), '🏈'.repeat(300), '漢'.repeat(300), 'Text https://example.test/extra-link repeated']) {
    const text = xPostText('Fantasy', 'Weekly headline', body, link);
    assert.ok(text.startsWith('Fantasy: Weekly headline'));
    assert.ok(text.endsWith(link));
    assert.equal((text.match(/https:\/\//g) ?? []).length, 1);
    const beforeLink = text.slice(0, -link.length);
    const weight = [...beforeLink].reduce((sum, c) => sum + (c.codePointAt(0) <= 127 ? 1 : 2), 0) + 23;
    assert.ok(weight <= 280, `Weighted length ${weight}`);
    assert.ok(!text.includes('\ufffd'));
  }
});
