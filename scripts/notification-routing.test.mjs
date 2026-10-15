import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const scope = 'https://mgtrabulsi-cell.github.io/FOT/';
const postId = '11111111-1111-4111-8111-111111111111';
const cases = [
  { tag: `gamewire-livewire-${postId}`, url: '/#wire', hash: `#livewire/post/${postId}` },
  { tag: 'gamewire-play-401872980-12345', url: '/#wire', hash: '#wire/game/401872980' },
  { tag: 'gamewire-401872980', url: '/#wire', hash: '#wire/game/401872980' },
  { tag: 'gamewire-test', url: `${scope}#wire`, hash: '#wire' },
  { tag: 'gamewire-update', url: `${scope}#wire/game/401872980`, hash: '#wire/game/401872980' },
];

for (const existing of [false, true]) {
  for (const { tag, url, hash } of cases) {
    test(`${tag}: ${existing ? 'reuse signed-in window' : 'open deployment URL'}`, async () => {
      const handlers = {};
      let destination;
      let focused = false;
      const client = {
        url: scope,
        postMessage(message) {
          assert.equal(message.type, 'GAMEWIRE_NOTIFICATION_OPEN');
          destination = message.url;
        },
        async focus() { focused = true; },
      };
      const self = {
        registration: { scope },
        clients: {
          async matchAll() {
            return existing ? [{ url: 'https://mgtrabulsi-cell.github.io/unrelated/' }, client] : [];
          },
          async openWindow(value) { destination = value; },
        },
        addEventListener(name, callback) { handlers[name] = callback; },
      };
      vm.runInNewContext(worker, { self, URL, console });
      let pending;
      handlers.notificationclick({
        notification: { tag, data: { url }, close() {} },
        waitUntil(promise) { pending = promise; },
      });
      await pending;
      assert.equal(destination, scope + hash);
      assert.equal(focused, existing);
    });
  }
}
