import assert from 'node:assert/strict';
import test from 'node:test';
import { connectMedianNavigation, hashForView, medianTabs, syncMedianTab, viewFromHash } from '../src/services/medianNavigation.ts';

test('section routes and nested notification links preserve their destination', () => {
  for (const [view, hash] of [['Wire', '#wire'], ['Players', '#stat-hub'], ['LiveWire', '#livewire'], ['Den', '#locker-room'], ['Profile', '#profile']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, '#unknown'), hash);
  }
  for (const [view, hash] of [['Wire', '#wire/game/123'], ['LiveWire', '#livewire/post/11111111-1111-4111-8111-111111111111']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, hash), hash);
  }
  assert.equal(viewFromHash('#stat-hub-invalid'), null);
  assert.equal(medianTabs.length, 4);
  assert.ok(medianTabs.every(tab => tab.url.startsWith('javascript:location.hash=') && tab.url.includes('hashchange')));
});

test('native menu readiness, view selection, browser fallback, and cleanup', () => {
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const classes = new Set();
  const calls = [];
  let view = 'Den';
  const window = {};
  const navigator = { userAgent: 'Mobile median' };
  const document = { documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } } };
  for (const [key, value] of Object.entries({ window, navigator, document })) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const stop = connectMedianNavigation(() => view);
    assert.equal(classes.size, 0);
    window.median = { tabNavigation: {
      setTabs: value => calls.push(['set', value]),
      selectTab: index => calls.push(['select', index]),
      deselect: () => calls.push(['deselect']),
    } };
    window.median_library_ready();
    assert.equal(classes.has('median-native-tabs'), true);
    assert.equal(calls[0][1].items.length, 4);
    assert.deepEqual(calls[1], ['select', 3]);
    view = 'Profile';
    syncMedianTab(view);
    assert.deepEqual(calls.at(-1), ['deselect']);
    stop();
    assert.equal(classes.size, 0);
    navigator.userAgent = 'Mobile Safari';
    const count = calls.length;
    connectMedianNavigation(() => 'Wire')();
    assert.equal(calls.length, count);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
