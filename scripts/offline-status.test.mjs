import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';

const source = readFileSync(new URL('../src/OfflineStatus.tsx', import.meta.url), 'utf8');

for (const native of [false, true]) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
    .replace(/from ['"]react['"]/g, `from '${import.meta.resolve('react')}'`)
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
    .replace(/import \{ Network \} from ['"]@capacitor\/network['"];/, 'const Network = {};')
    .replace(/import \{ nativeApp \} from ['"].\/services\/nativeOffline['"];/, `const nativeApp = ${native};`);
  const { default: OfflineStatus } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

  test(`${native ? 'Native' : 'Website'} saves quietly online and retains the disconnected notice`, () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let online = true;
    let savedAt = null;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => savedAt } });
    try {
      assert.equal(renderToStaticMarkup(createElement(OfflineStatus)), '');
      savedAt = '2026-10-16T12:00:00.000Z';
      assert.equal(renderToStaticMarkup(createElement(OfflineStatus)), '');
      online = false;
      const offline = renderToStaticMarkup(createElement(OfflineStatus));
      assert.match(offline, /Offline — saved browsing/);
      assert.match(offline, /Scores and stats are not live/);
      assert.match(offline, /Weekly copy saved/);
      assert.doesNotMatch(offline, /Native background refresh/);
      online = true;
      assert.equal(renderToStaticMarkup(createElement(OfflineStatus)), '');
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      else delete globalThis.navigator;
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
      else delete globalThis.localStorage;
    }
  });
}
