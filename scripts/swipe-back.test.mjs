import assert from 'node:assert/strict';
import test from 'node:test';
import { connectSwipeBack } from '../src/services/swipeBack.ts';

function setup(run) {
  const names = ['window', 'document', 'Element', 'getComputedStyle'];
  const originals = Object.fromEntries(names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Element {
    parentElement = null;
    scrollWidth = 100;
    clientWidth = 100;
    overflowX = 'visible';
    blocked = false;
    nearestRoot = null;
    closest(selector) { return selector === '[data-swipe-back-root]' ? this.nearestRoot : this.blocked ? this : null; }
  }
  const handlers = new Map();
  const root = new Element();
  root.nearestRoot = root;
  root.contains = (element) => element === root || element === target;
  root.setAttribute = () => {};
  root.removeAttribute = () => {};
  root.addEventListener = (name, callback) => handlers.set(name, callback);
  root.removeEventListener = (name) => handlers.delete(name);
  const target = new Element();
  target.parentElement = root;
  target.nearestRoot = root;
  const window = { innerWidth: 390, mobile: true, selected: '', matchMedia: () => ({ matches: window.mobile }), getSelection: () => ({ toString: () => window.selected }) };
  const document = { modal: null, querySelector: () => document.modal };
  for (const [name, value] of Object.entries({ window, document, Element, getComputedStyle: (element) => ({ overflowX: element.overflowX }) })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let backs = 0;
  const stop = connectSwipeBack(root, () => backs++);
  const touch = (x, y, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  const fire = (name, touches, changedTouches = [], extra = {}) => {
    const event = { target, touches, changedTouches, cancelable: true, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    handlers.get(name)?.(event);
    return event;
  };
  const swipe = (dx = 110, dy = 0) => {
    fire('touchstart', [touch(40, 100)]);
    fire('touchmove', [touch(40 + dx, 100 + dy)]);
    fire('touchend', [], [touch(40 + dx, 100 + dy)]);
  };
  try { run({ root, target, window, document, touch, fire, swipe, stop, handlers, backs: () => backs }); }
  finally {
    stop();
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('Mobile rightward swipe invokes back exactly once and detaches cleanly', () => setup(({ swipe, backs, stop, handlers }) => {
  swipe();
  assert.equal(backs(), 1);
  stop();
  assert.equal(handlers.size, 0);
  swipe();
  assert.equal(backs(), 1);
}));

test('Wrong direction, short movement, vertical scrolling and desktop gestures never go back', () => setup(({ swipe, backs, window }) => {
  swipe(-110);
  swipe(50);
  swipe(110, 60);
  swipe(5, 110);
  window.mobile = false;
  swipe();
  assert.equal(backs(), 0);
}));

test('Controls, selected text, horizontal scrollers and nested windows retain their gestures', () => setup(({ swipe, target, root, window, document, backs }) => {
  target.blocked = true;
  swipe();
  target.blocked = false;
  window.selected = 'Selected text';
  swipe();
  window.selected = '';
  target.overflowX = 'auto';
  target.scrollWidth = 500;
  swipe();
  target.overflowX = 'visible';
  target.nearestRoot = {};
  swipe();
  target.nearestRoot = root;
  document.modal = { contains: () => false };
  swipe();
  assert.equal(backs(), 0);
  document.modal = { contains: () => true };
  swipe();
  assert.equal(backs(), 1);
}));

test('Multi-touch, cancellation, unpreventable scrolls and vertical-first gestures cannot become back swipes', () => setup(({ fire, touch, backs }) => {
  fire('touchstart', [touch(10, 100), touch(30, 100, 2)]);
  fire('touchmove', [touch(130, 100)]);
  fire('touchend', [], [touch(130, 100)]);
  fire('touchstart', [touch(10, 100)]);
  fire('touchmove', [touch(130, 100), touch(150, 100, 2)]);
  fire('touchend', [], [touch(130, 100)]);
  fire('touchstart', [touch(10, 100)]);
  fire('touchmove', [touch(130, 100)], [], { cancelable: false });
  fire('touchend', [], [touch(130, 100)]);
  fire('touchstart', [touch(10, 100)]);
  fire('touchmove', [touch(130, 100)]);
  fire('touchcancel', []);
  fire('touchend', [], [touch(130, 100)]);
  fire('touchstart', [touch(10, 100)]);
  fire('touchmove', [touch(15, 140)]);
  fire('touchmove', [touch(130, 100)]);
  fire('touchend', [], [touch(130, 100)]);
  assert.equal(backs(), 0);
}));
