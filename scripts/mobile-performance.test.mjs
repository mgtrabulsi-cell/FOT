import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const app = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect') effects.push(node.arguments[0].getText(app));
  ts.forEachChild(node, visit);
}
visit(app);
const compile = (source, context) => vm.runInContext(ts.transpileModule(`(${source})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText, context);

test('Mobile NFL viewing performs no unrelated NBA roster, box, or nearby-date downloads', async () => {
  for (const warmNBA of [false, true]) {
    const calls = { scoreboard: 0, boxes: 0, rosters: 0, dates: 0 };
    const noop = () => {};
    const context = vm.createContext({
      warmNBA, AbortController, console, selectedNBADate: '2026-10-25',
      nbaDateOverride: true, document: { visibilityState: 'visible' },
      window: { setInterval: () => 1, clearInterval: noop },
      readRenderSnapshot: () => ({ games: [{ id: 'NBA:1' }] }),
      setNBAGames: noop, setNBAGamesDate: noop, setNBAStatus: noop, setNBAError: noop,
      fetchNBAScoreboard: async () => { calls.scoreboard++; return [{ id: 'NBA:1' }]; },
      preloadNBABoxes: async () => { calls.boxes++; return []; },
      preloadNBAPregame: async () => { calls.rosters++; return []; },
      preloadNBADates: async () => { calls.dates++; return []; },
    });
    const stopBoard = compile(effects.find((effect) => effect.includes('preloadNBABoxes(')), context)();
    const stopDates = compile(effects.find((effect) => effect.includes('preloadNBADates(')), context)();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.scoreboard, 1, 'Lightweight current NBA scores stay available');
    if (!warmNBA) assert.deepEqual(calls, { scoreboard: 1, boxes: 0, rosters: 0, dates: 0 });
    else {
      assert.ok(calls.boxes > 0 && calls.rosters > 0);
      assert.equal(calls.dates, 1, 'Opening NBA retains its instant-open preloads');
    }
    stopBoard(); stopDates?.();
  }
});

test('Full-week offline downloads pause during live mobile games, without disabling desktop or pregame saving', () => {
  const source = readFileSync(new URL('../src/useOfflineSnapshots.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('useOfflineSnapshots.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hook = parsed.statements.find((node) => ts.isFunctionDeclaration(node));
  const code = ts.transpileModule(hook.getText(parsed).replace('export ', '').replace('import.meta.env.PROD', 'true'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const [mobile, status, expectedTimers] of [[true, 'LIVE', 0], [true, 'UPCOMING', 2], [false, 'LIVE', 2]]) {
    let timers = 0, cleanup;
    const noop = () => {};
    const context = vm.createContext({
      AbortController, nativeApp: false, offlineSnapshotInterval: 300000,
      navigator: { onLine: true }, document: { addEventListener: noop, removeEventListener: noop },
      window: {
        matchMedia: () => ({ matches: mobile }), addEventListener: noop, removeEventListener: noop,
        setTimeout: () => ++timers, setInterval: () => ++timers,
        clearTimeout: noop, clearInterval: noop,
      },
      useRef: (value) => ({ current: value }),
      useEffect: (callback) => { cleanup = callback(); },
    });
    vm.runInContext(code, context);
    context.useOfflineSnapshots([{ league: 'NFL', seasonYear: 2026, eventId: '123', status }], true);
    assert.equal(timers, expectedTimers);
    cleanup?.();
  }
});
