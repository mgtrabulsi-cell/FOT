import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function fixture({ online = true, storageFails = false } = {}) {
  const handlers = {}, stored = new Map(), navigations = [], errors = [];
  const help = { hidden: true }, button = { hidden: true, addEventListener: (_type, callback) => { button.click = callback; } };
  let timeout, mounted = false;
  class Script { type = 'module'; }
  vm.runInNewContext(source, {
    URL, Date, HTMLScriptElement: Script, navigator: { onLine: online },
    location: { href: 'https://gamewire.us/?existing=1#wire', replace: url => navigations.push(url) },
    sessionStorage: {
      getItem: key => { if (storageFails) throw Error('Storage denied'); return stored.get(key) ?? null; },
      setItem: (key, value) => stored.set(key, value),
    },
    document: { getElementById: id => mounted ? null : id === 'gamewire-startup-help' ? help : button },
    window: { addEventListener: (name, callback) => { handlers[name] = callback; } },
    setTimeout: (callback, delay) => { assert.equal(delay, 15000); timeout = callback; },
    console: { error: (...values) => errors.push(values) },
  });
  return { handlers, help, button, stored, navigations, errors, timeout,
    mount: () => { mounted = true; }, failure: () => handlers.error({ target: new Script(), preventDefault() {} }) };
}
test('Failed entry bundle reloads once with a cache-busting URL, retaining route and query', () => {
  const api = fixture();
  api.failure(); api.failure();
  assert.equal(api.navigations.length, 1);
  const url = new URL(api.navigations[0]);
  assert.equal(url.hash, '#wire');
  assert.equal(url.searchParams.get('existing'), '1');
  assert.ok(url.searchParams.has('gw-recover'));
  assert.equal(api.help.hidden, false);
  assert.equal(api.stored.size, 1);
});
test('Offline or blocked storage offers explicit manual recovery without reload loops', () => {
  for (const options of [{ online: false }, { storageFails: true }]) {
    const api = fixture(options);
    api.failure();
    assert.equal(api.navigations.length, 0);
    assert.equal(api.button.hidden, false);
    assert.ok(api.errors.length);
    api.button.click();
    assert.equal(api.navigations.length, 1);
  }
});
test('Slow startup exposes help at fifteen seconds; successful mount is left alone', () => {
  const slow = fixture(); slow.timeout();
  assert.equal(slow.help.hidden, false);
  const ready = fixture(); ready.mount(); ready.timeout();
  assert.equal(ready.help.hidden, true);
});
test('Lazy preload failures use the same bounded recovery', () => {
  const api = fixture();
  api.handlers['vite:preloadError']({ preventDefault() {} });
  assert.equal(api.navigations.length, 1);
});
