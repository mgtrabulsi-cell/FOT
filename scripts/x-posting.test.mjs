import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { xAuthorization, xImagePostText, xSource } from '../supabase/functions/_shared/xPosting.ts';

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

test('Image tweet keeps headline, subject, every emoji pick and the canonical link, not the analysis', () => {
  const link = 'https://gamewire.us/#analyst-desk/story/11111111-1111-4111-8111-111111111111';
  const source = { title: 'Opening night', subject: 'SGA', analysis: 'Full analysis in the image.', gameId: 'NBA:123',
    picks: ['pending', 'hit', 'miss'].map((result, i) => ({ id: String(i), text: `Player ${6 + i}+ assists`, result })) };
  const text = xImagePostText(source, link);
  assert.ok(text.startsWith('Opening night\n\nSGA'));
  assert.ok(text.includes('🏀 Player 6+ assists\n🏀 ✅ Player 7+ assists\n🏀 ❌ Player 8+ assists'));
  assert.ok(text.endsWith(link));
  assert.ok(!text.includes(source.analysis));
  for (const [gameId, emoji] of [['NFL:1','🏈'],['NHL:1','🏒'],['UCL:1','⚽'],['SOCCER:1','⚽']]) {
    assert.ok(xImagePostText({ ...source, gameId }, link).includes(emoji));
  }
  assert.ok(!xImagePostText({ ...source, picks: [] }, link).includes('Admin picks'));
  assert.equal(xImagePostText({ ...source, subject: source.title, picks: [] }, link), `Opening night\n\n${link}`);
});

test('Caption refuses overflow instead of dropping or truncating picks; exact weighted boundary is allowed', () => {
  const source = { title: 'x'.repeat(255), subject: '', analysis: 'Text', gameId: '', picks: [] };
  assert.equal(xImagePostText(source, 'https://gamewire.us').split('\n')[0].length, 255);
  assert.throws(() => xImagePostText({ ...source, title: 'x'.repeat(256) }, 'https://gamewire.us'), /280-character/);
  assert.throws(() => xImagePostText({ ...source, title: '漢'.repeat(128) }, 'https://gamewire.us'), /280-character/);
  assert.throws(() => xImagePostText({ ...source, title: 'Heading', picks: [{ text: 'Long selection '.repeat(50), result: 'pending' }] }, 'https://gamewire.us'), /280-character/);
});

test('Source normalization includes all analysis sections, legacy picks and no invented LIVEWIRE picks', () => {
  const row = { title: 'Headline', subject: 'Subject', game_id: 'NFL:1', narrative: 'Narrative', evidence: 'Evidence text', counterpoint: 'Counterpoint text', pick: 'Legacy pick' };
  const source = xSource(row, true, '11111111-1111-4111-8111-111111111111');
  assert.equal(source.analysis, 'Narrative\n\nEvidence\nEvidence text\n\nCounterpoint\nCounterpoint text');
  assert.equal(source.picks[0].text, 'Legacy pick');
  assert.deepEqual(xSource({ ...row, picks: [] }, true, 'id').picks, []);
  assert.throws(() => xSource({ ...row, picks: [{}] }, true, 'id'), /invalid admin picks/);
  assert.throws(() => xSource({ ...row, narrative: null }, true, 'id'), /invalid narrative/);
  assert.deepEqual(xSource({ title: null, body: 'News body' }, false, 'id'), { title: 'GameWire update', subject: '', analysis: 'News body', gameId: '', picks: [] });
});

test('Start/Sit tweets contain exactly the LIVEWIRE subject, no URL or other wording, and reference the original PNG', () => {
  for (const kind of ['Start', 'Sit']) for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const title = `Week 7 Must ${kind} Fantasy ${position}`;
    const source = xSource({ title, body: '', fantasy_graphic_id: 'graphic-id',
      image_paths: ['11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png'] }, false, 'id');
    assert.equal(xImagePostText(source, 'https://gamewire.us/#livewire/post/id'), title);
    assert.equal(source.graphicImage, '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png');
    assert.equal(source.analysis, '');
    assert.deepEqual(source.picks, []);
  }
  const row = { title: 'Week 7 Must Start Fantasy QB', body: '', fantasy_graphic_id: 'graphic-id', image_paths: ['a/b.png'] };
  for (const change of [{ body: 'Extra wording' }, { title: 'Invalid title' }, { image_paths: [] }, { image_paths: ['https://example.com/image.png'] }]) {
    assert.throws(() => xSource({ ...row, ...change }, false, 'id'), /invalid subject or graphic/);
  }
});
