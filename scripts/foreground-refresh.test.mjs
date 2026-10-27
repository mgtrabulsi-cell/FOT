import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { subscribeForegroundRefresh } from '../src/services/foregroundRefresh.ts';

test('Returning, restoring and reconnecting refresh immediately without duplicate foreground requests', () => {
  const previous = new Map(['window', 'document', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalNow = Date.now;
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.visibilityState = 'hidden';
  const network = { onLine: true };
  let now = 0;
  let refreshes = 0;
  let unsubscribe;
  try {
    for (const [name, value] of [['window', windowTarget], ['document', documentTarget], ['navigator', network]]) {
      Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    Date.now = () => now;
    unsubscribe = subscribeForegroundRefresh(() => refreshes++);
    assert.equal(refreshes, 0);
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    windowTarget.dispatchEvent(new Event('focus'));
    assert.equal(refreshes, 0, 'A hidden page does not start requests');
    documentTarget.visibilityState = 'visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    assert.equal(refreshes, 1, 'Resuming refreshes synchronously, not after a polling interval');
    for (const type of ['focus', 'pageshow', 'online']) windowTarget.dispatchEvent(new Event(type));
    assert.equal(refreshes, 1, 'One foreground transition is coalesced');
    now += 60_000;
    windowTarget.dispatchEvent(new Event('pageshow'));
    assert.equal(refreshes, 2, 'Restoring a back/forward cached page refreshes');
    now += 60_000;
    network.onLine = false;
    windowTarget.dispatchEvent(new Event('focus'));
    assert.equal(refreshes, 2, 'Offline resumes retain saved data without a new request');
    network.onLine = true;
    windowTarget.dispatchEvent(new Event('online'));
    assert.equal(refreshes, 3, 'Reconnecting refreshes immediately');
    now += 60_000;
    documentTarget.dispatchEvent(new Event('resume'));
    assert.equal(refreshes, 4, 'Page lifecycle resume refreshes');
    now += 60_000;
    windowTarget.dispatchEvent(new Event('gamewire-app-active'));
    assert.equal(refreshes, 5, 'Native iPhone app activation refreshes even without a browser visibility event');
    unsubscribe();
    now += 60_000;
    for (const type of ['focus', 'pageshow', 'online', 'gamewire-app-active']) windowTarget.dispatchEvent(new Event(type));
    for (const type of ['visibilitychange', 'resume']) documentTarget.dispatchEvent(new Event(type));
    assert.equal(refreshes, 5, 'Unmounting removes all listeners');
  } finally {
    unsubscribe?.();
    Date.now = originalNow;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('The actual scoreboard effect fetches immediately and cancels the old request when returning', async () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let polling;
  let foreground;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') {
      const callback = node.arguments[0]?.getText(parsed);
      if (callback?.includes('await fetchScoreboards(')) polling = callback;
      if (callback?.includes('subscribeForegroundRefresh(') && callback.includes('setScoreboardRetry')) foreground = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(polling && foreground, 'Both real scoreboard effects must be present');
  const requests = [];
  const applied = [];
  const storedRequests = [];
  let onReturn;
  let cleanup;
  let run;
  const noop = () => {};
  const context = vm.createContext({
    AbortController,
    window: { setInterval: () => 1, clearInterval: noop, clearTimeout: noop },
    gamesRef: { current: [] }, selectedNFLWeek: 7,
    fetchStoredNFLScoreboard: (week, signal) => new Promise((resolve) => storedRequests.push({ week, signal, resolve })),
    fetchScoreboards: (signal, week) => new Promise((resolve) => requests.push({ signal, week, resolve })),
    getTuesdayCutoff: () => 0,
    setCurrentNFLWeek: noop, setScoreUpdates: noop, setScoreboardStatus: noop,
    setGames: (games) => applied.push(games), setLoadedNFLWeek: noop, setFailedLeagues: noop,
    setSelectedGameId: noop, pruneExpiredLockerRoomUpdates: noop,
    subscribeForegroundRefresh: (callback) => { onReturn = callback; return () => { onReturn = undefined; }; },
    setScoreboardRetry: () => { cleanup(); cleanup = run(); },
  });
  const compile = (callback) => vm.runInContext(ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, context);
  run = compile(polling);
  cleanup = run();
  const stopForeground = compile(foreground)();
  try {
    assert.equal(requests.length, 1, 'Initial open fetches without waiting for a timer');
    onReturn();
    assert.equal(requests.length, 2, 'Return starts a fresh scoreboard request immediately');
    assert.equal(requests[0].signal.aborted, true, 'A suspended old request cannot overwrite fresh data');
    assert.equal(requests[1].week, 7, 'Return preserves the selected week');
    requests[0].resolve({ nflWeek: 6, games: [], failedLeagues: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(applied.length, 0, 'Old response is ignored');
    requests[1].resolve({ nflWeek: 7, games: [], failedLeagues: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(applied.length, 1, 'Fresh response updates the board without a second polling cycle');
    storedRequests.forEach((request) => request.resolve({ nflWeek: 7, games: [{ id: 'old-database-game' }] }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(applied.length, 1, 'An aborted bootstrap or an older shared schedule must not overwrite a successful fresh read');
  } finally {
    cleanup();
    stopForeground();
  }
});
