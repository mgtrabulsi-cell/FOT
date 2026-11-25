import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite } from './site-health.mjs';

function fixture(failure) {
  return async url => {
    const path = new URL(url).pathname;
    if (path === '/') return new Response('<div id="root"></div><script src="/assets/app-old.js"></script><link href="/assets/app-old.css">');
    if (path === '/sw.js') return new Response('self.GAMEWIRE_OFFLINE = {"assets":["index.html","assets/app-old.js","assets/app-old.css","assets/lazy-old.js"]};\n');
    if (path === failure) return new Response('Missing', { status: 404 });
    return new Response('previous build', { headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } });
  };
}
test('Health check catches missing lazy chunks, not just a successful HTML response', async () => {
  await checkSite({ fetcher: fixture() });
  await assert.rejects(checkSite({ fetcher: fixture('/assets/lazy-old.js') }), /lazy-old.js returned HTTP 404/);
});
test('Previous build assets are retained without overwriting the newly built files', async () => {
  const output = await mkdtemp(join(tmpdir(), 'gamewire-health-'));
  try {
    await mkdir(join(output, 'assets'));
    await writeFile(join(output, 'assets', 'app-old.js'), 'new build');
    await checkSite({ fetcher: fixture(), preserve: true, output });
    assert.equal(await readFile(join(output, 'assets', 'app-old.js'), 'utf8'), 'new build');
    assert.equal(await readFile(join(output, 'assets', 'lazy-old.js'), 'utf8'), 'previous build');
  } finally { await rm(output, { recursive: true }); }
});
