import assert from 'node:assert/strict';
import test from 'node:test';
import { observePostViews } from '../src/services/livewireViews.ts';

function fixture() {
  const original = Object.fromEntries(['document', 'navigator', 'window', 'IntersectionObserver', 'MutationObserver']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const window = new EventTarget();
  const navigator = { onLine: true };
  const observed = new Set();
  let intersections;
  let mutations;
  const makePost = (id) => ({ getAttribute: (key) => key === 'data-post-id' ? id : null });
  const first = makePost('first');
  const second = makePost('second');
  let elements = [first, second];
  const root = { querySelectorAll: () => elements };
  const globals = {
    document, navigator, window,
    IntersectionObserver: class {
      constructor(callback) { intersections = callback; }
      observe(element) { observed.add(element); }
      unobserve(element) { observed.delete(element); }
      disconnect() { observed.clear(); }
    },
    MutationObserver: class {
      constructor(callback) { mutations = callback; }
      observe() {}
      disconnect() {}
    },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const calls = [];
  const errors = [];
  let fail = false;
  const stop = observePostViews(root, async (id) => {
    calls.push(id);
    if (fail) throw new Error('Write failed');
  }, (error) => errors.push(error));
  return {
    calls, errors, first, second, observed,
    show(element, ratio = 0.5) { intersections([{ target: element, isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    mutate(next) { elements = next; mutations(); },
    hidden() { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    visible() { document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); },
    offline() { navigator.onLine = false; },
    online() { navigator.onLine = true; window.dispatchEvent(new Event('online')); },
    fail() { fail = true; },
    stop,
    restore() {
      stop();
      for (const [key, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('Counts viewport entry, not offscreen loading, and counts again after leaving/reappearing', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.calls, []);
    f.show(f.first);
    f.show(f.first, 0.8);
    assert.deepEqual(f.calls, ['first']);
    f.show(f.first, 0);
    f.show(f.first);
    f.show(f.second);
    assert.deepEqual(f.calls, ['first', 'first', 'second']);
  } finally { f.restore(); }
});

test('Feed rerenders and new posts do not recount existing visible posts', () => {
  const f = fixture();
  try {
    f.show(f.first);
    f.mutate([f.first, f.second]);
    f.show(f.first);
    assert.deepEqual(f.calls, ['first']);
    f.mutate([f.second]);
    assert.equal(f.observed.has(f.first), false);
    f.mutate([f.first, f.second]);
    f.show(f.first);
    assert.deepEqual(f.calls, ['first', 'first']);
  } finally { f.restore(); }
});

test('Hidden tabs do not count, returning counts a new appearance, and reconnect counts visible offline posts', () => {
  const f = fixture();
  try {
    f.hidden();
    f.show(f.first);
    assert.deepEqual(f.calls, []);
    f.visible();
    assert.deepEqual(f.calls, ['first']);
    f.hidden();
    f.visible();
    assert.deepEqual(f.calls, ['first', 'first']);
    f.offline();
    f.show(f.second);
    assert.equal(f.calls.length, 2);
    f.online();
    assert.deepEqual(f.calls, ['first', 'first', 'second']);
  } finally { f.restore(); }
});

test('Failures are reported without retry loops, and cleanup prevents later records', async () => {
  const f = fixture();
  try {
    f.fail();
    f.show(f.first);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.errors.length, 1);
    f.show(f.first);
    assert.equal(f.calls.length, 1);
    f.stop();
    f.show(f.second);
    f.hidden();
    f.visible();
    assert.equal(f.calls.length, 1);
    assert.equal(f.observed.size, 0);
  } finally { f.restore(); }
});
