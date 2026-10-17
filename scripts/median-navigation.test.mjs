import assert from 'node:assert/strict';
import test from 'node:test';
import { connectMedianNavigation, hashForView, viewFromHash } from '../src/services/medianNavigation.ts';

test('section routes and nested notification links preserve their destination', () => {
  for (const [view, hash] of [['Wire', '#wire'], ['Players', '#stat-hub'], ['Analyst', '#analyst-desk'], ['LiveWire', '#livewire'], ['Den', '#locker-room'], ['Profile', '#profile']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, '#unknown'), hash);
  }
  for (const [view, hash] of [['Wire', '#wire/game/123'], ['LiveWire', '#livewire/post/11111111-1111-4111-8111-111111111111'], ['Analyst', '#analyst-desk/story/11111111-1111-4111-8111-111111111111']]) {
    assert.equal(viewFromHash(hash), view);
    assert.equal(hashForView(view, hash), hash);
  }
  assert.equal(viewFromHash('#stat-hub-invalid'), null);
});

test('native tabs stay disabled on immediate and delayed bridge readiness; browsers are unchanged', () => {
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const classes = new Set();
  const calls = [];
  let previousReadyCalls = 0;
  const previousReady = () => previousReadyCalls++;
  const window = { median_library_ready: previousReady };
  const navigator = { userAgent: 'Mobile median' };
  const document = { documentElement: { classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } } };
  for (const [key, value] of Object.entries({ window, navigator, document })) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    const stop = connectMedianNavigation();
    assert.equal(classes.size, 0);
    window.median = { tabNavigation: {
      setTabs: value => calls.push(['set', value]),
    } };
    window.median_library_ready();
    assert.equal(previousReadyCalls, 1);
    assert.equal(classes.size, 0);
    assert.deepEqual(calls, [['set', { enabled: false }]]);
    stop();
    assert.equal(window.median_library_ready, previousReady);
    connectMedianNavigation()();
    assert.deepEqual(calls.at(-1), ['set', { enabled: false }]);
    assert.equal(calls.length, 2);
    assert.equal(classes.size, 0);
    navigator.userAgent = 'Mobile Safari';
    const count = calls.length;
    connectMedianNavigation()();
    assert.equal(calls.length, count);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
