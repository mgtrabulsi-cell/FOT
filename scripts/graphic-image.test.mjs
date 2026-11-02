import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { graphicImage } from '../supabase/functions/parlay-roster/graphicImage.ts';
const portrait = 'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png';
const cors = { 'Access-Control-Allow-Origin': '*' };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
test('Image relay only accepts bounded ESPN player portraits/team logos and returns canvas-safe PNG bytes', async () => {
  for (const url of [portrait, 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png']) {
    const response = await graphicImage(url, async (source, options) => {
      assert.equal(source, url); assert.equal(options.redirect, 'error');
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }, cors);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  }
  for (const url of ['http://a.espncdn.com/i/teamlogos/nfl/500/kc.png', 'https://example.com/image.png',
    'https://a.espncdn.com.evil.test/i/teamlogos/nfl/500/kc.png', portrait + '?redirect=bad', portrait + '#bad',
    'https://name@a.espncdn.com/i/teamlogos/nfl/500/kc.png', 'https://a.espncdn.com/other.png']) {
    assert.equal((await graphicImage(url, () => { throw new Error('Rejected URL must not be fetched'); }, cors)).status, 400);
  }
});
test('Image relay rejects upstream errors, invalid types, fake PNGs, empty and oversized bodies', async () => {
  const original = console.error; console.error = () => {};
  try {
    for (const response of [new Response('', { status: 404 }), new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      new Response('fake', { headers: { 'content-type': 'image/png' } }),
      new Response('', { headers: { 'content-type': 'image/png' } }),
      new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) } }),
      new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })]) {
      assert.equal((await graphicImage(portrait, async () => response, cors)).status, 502);
    }
  } finally { console.error = original; }
});
function loader({ directFails = true, relayFails = false, blobFails = false } = {}) {
  const calls = [], revoked = [], warnings = [], decoded = [];
  const context = vm.createContext({ exports: {}, URL: class extends URL {
    static createObjectURL() { return 'blob:graphic'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }, AbortSignal, setTimeout, clearTimeout, console: { warn: (...args) => warnings.push(args) },
  Image: class {
    set src(url) { decoded.push([url, this.crossOrigin, this.referrerPolicy]);
      queueMicrotask(() => ((url.startsWith('blob:') ? blobFails : directFails) ? this.onerror : this.onload)()); }
  },
  fetch: async (url, options) => { calls.push([String(url), options]);
    return new Response(png, { status: relayFails ? 502 : 200, headers: { 'content-type': 'image/png' } }); },
  require: name => name.includes('supabaseClient') ? { publicSupabaseConfig: { url: 'https://example.supabase.co' } } : {} });
  vm.runInContext(ts.transpileModule(readFileSync(new URL('../src/services/parlayGraphicImage.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { load: context.exports.loadGraphicImage, calls, revoked, warnings, decoded };
}
test('Failed cross-origin image loads retry through relay and decode local blobs with cache sharing and cleanup', async () => {
  const r = loader();
  const [a, b] = await Promise.all([r.load(portrait), r.load(portrait)]);
  assert.equal(a, b); assert.equal(r.calls.length, 1);
  assert.equal(new URL(r.calls[0][0]).searchParams.get('image'), portrait);
  assert.equal(r.calls[0][1].credentials, 'omit');
  assert.deepEqual(r.revoked, ['blob:graphic']); assert.equal(r.warnings.length, 1);
  assert.ok(r.decoded.every(([, cors, referrer]) => cors === 'anonymous' && referrer === 'no-referrer'));
  const direct = loader({ directFails: false }); await direct.load(portrait); assert.equal(direct.calls.length, 0);
});
test('Relay failures stay explicit and retryable; failed blob decodes still revoke URLs', async () => {
  const r = loader({ relayFails: true });
  await assert.rejects(r.load(portrait), /image-service retry/);
  await assert.rejects(r.load(portrait), /image-service retry/);
  assert.equal(r.calls.length, 2, 'Failures cannot poison retry cache');
  const decode = loader({ blobFails: true }); await assert.rejects(decode.load(portrait), /could not load/);
  assert.deepEqual(decode.revoked, ['blob:graphic']);
  const unsupported = loader(); await assert.rejects(unsupported.load('https://example.com/photo.png'), /could not load/);
  assert.equal(unsupported.calls.length, 0);
});
