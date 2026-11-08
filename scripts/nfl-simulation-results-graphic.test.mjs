import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as accuracy from '../supabase/functions/_shared/nflSimulationAccuracy.ts';

const now = Date.parse('2026-11-08T23:00:00Z');
const scopes = [{ date: '2026-11-05T23:00:00Z' }, { date: '2026-11-09T23:00:00Z' }];
const result = (id, projectedHome, projectedAway, actualHome, actualAway, error = 0) => ({
  eventId: id, error, home: { name: 'Home Team', abbr: 'HOM', projected: projectedHome, actual: actualHome },
  away: { name: 'Away Team', abbr: 'AWY', projected: projectedAway, actual: actualAway }, players: [],
});
const report = () => ({
  pending: 2, issues: ['Missing archive'],
  games: [result('1', 28, 21, 28, 21, 0), result('2', 21, 24, 21, 24, 0),
    result('3', 28, 24, 21, 24, 3.5), result('4', 24, 21, 24, 24, 1.5), result('5', 22.4, 22.2, 20, 17, 3.5)],
});
function graphicHarness() {
  const drawn = [], fontSizes = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({
    createLinearGradient: () => gradient,
    measureText: value => ({ width: value.length * 11 }),
    fillText(value, x, y) {
      assert.ok(x >= 0 && x < 1080 && y > 0 && y < 1350);
      drawn.push(value); fontSizes.push(this.font);
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    toBlob(callback, type) { assert.equal(type, 'image/png'); callback(new Blob(['png'], { type })); } };
  const context = vm.createContext({ exports: {}, Intl, Date, Math, Number, Error, Blob,
    document: { createElement: () => canvas }, require(name) {
      if (name.includes('gamewaireResultsGraphic')) return { loadGamewireGraphicAssets: async () => ({ naturalWidth: 400, naturalHeight: 400 }) };
      if (name.includes('nflSimulationAccuracy')) return accuracy;
      return {};
    } });
  const code = ts.transpileModule(readFileSync(new URL('../src/services/nflSimulationResultsGraphic.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  return { ...context.exports, canvas, drawn, fontSizes };
}
test('Weekly winner record covers all verified games, with ties and no-winner forecasts separate', () => {
  const { simulationWinnerRecord } = graphicHarness();
  const record = simulationWinnerRecord(report().games);
  assert.equal(record.wins, 2); assert.equal(record.losses, 1);
  assert.equal(record.ties, 1); assert.equal(record.noWinner, 1);
});
test('Game graphic snapshots the top three but grades the entire selected week and freezes copied values', () => {
  const { simulationResultsGraphicSnapshot } = graphicHarness(), data = report();
  const snapshot = simulationResultsGraphicSnapshot(data, scopes, 'games', 'passingYards', now);
  assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.record.losses, 1); assert.equal(snapshot.verified, 5);
  assert.equal(snapshot.pending, 2); assert.equal(snapshot.excluded, 1);
  assert.equal(snapshot.capturedAt, new Date(now).toISOString());
  assert.match(snapshot.slate, /Nov 5.*Nov 9/);
  data.games[0].home.projected = 99;
  assert.equal(snapshot.rows[0].simulated, '21 - 28');
  assert.equal(snapshot.record.wins, 2);
});
test('Player graphic uses only qualifying selected-stat results and preserves the overall game winner record', () => {
  const { simulationResultsGraphicSnapshot } = graphicHarness(), data = report();
  data.games[0].players = [
    { playerId: '1', name: 'Low volume', position: 'QB', team: 'HOM', stat: 'passingYards', projected: 100, actual: 100, error: 0 },
    ...Array.from({ length: 4 }, (_, i) => ({ playerId: String(i + 2), name: `Passer ${i}`, position: 'QB',
      team: 'HOM', stat: 'passingYards', projected: 250 + i, actual: 250, error: i })),
    { playerId: '10', name: 'Receiver', position: 'WR', team: 'AWY', stat: 'receptions', projected: 3, actual: 3, error: 0 },
  ];
  const snapshot = simulationResultsGraphicSnapshot(data, scopes, 'players', 'passingYards', now);
  assert.equal(snapshot.rows.length, 3); assert.equal(snapshot.rows[0].title, 'Passer 0');
  assert.equal(snapshot.minimum, 200); assert.equal(snapshot.record.wins, 2);
  assert.ok(snapshot.rows.every(row => /Passer/.test(row.title)));
});
test('Instagram PNG is portrait, contains the current record and timestamp, and exports explicit errors', async () => {
  const h = graphicHarness(), snapshot = h.simulationResultsGraphicSnapshot(report(), scopes, 'games', 'passingYards', now);
  const blob = await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(blob.type, 'image/png'); assert.equal(h.canvas.width, 1080); assert.equal(h.canvas.height, 1350);
  assert.ok(h.drawn.includes('TOP 3 GAME SIMULATIONS'));
  assert.ok(h.drawn.includes('2W - 1L - 1T'));
  assert.ok(h.drawn.some(text => /Downloaded .* ET/.test(text)));
  assert.ok(h.drawn.some(text => /1 no winner forecast/.test(text)));
  h.canvas.toBlob = callback => callback(null);
  await assert.rejects(h.renderSimulationResultsGraphic(snapshot), /export the Instagram PNG/);
  assert.throws(() => h.simulationResultsGraphicSnapshot({ games: [], issues: [], pending: 0 }, scopes, 'games', 'passingYards', now), /No verified game/);
  assert.throws(() => h.simulationResultsGraphicSnapshot(report(), scopes, 'players', 'passingYards', now), /No player simulations/);
});
test('Each download refreshes the entire selected week and uses the fresh winner record rather than cached UI results', async () => {
  const h = graphicHarness(), effects = [], requests = [];
  let calls = 0;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, AbortController, Error, require(name) {
    if (name === 'react') return { useRef: () => ({ current: new Set() }), useEffect: fn => effects.push(fn) };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('GamewaireResultsDownload')) return { ResultsGraphicDownload: 'Download' };
    if (name.includes('gamewireBot')) return { loadSimulationAccuracy: async (games, signal) => {
      assert.equal(games, scopes); assert.equal(signal.aborted, false); requests.push(signal); calls++;
      const data = report();
      if (calls > 1) data.games[0].home.actual = 14;
      data.games[0].players = [{ playerId: '1', name: 'Receiver', position: 'WR', team: 'HOM', stat: 'receptions', projected: 3, actual: 3, error: 0 }];
      return data;
    } };
    if (name.includes('nflSimulationResultsGraphic')) return { simulationResultsGraphicSnapshot: h.simulationResultsGraphicSnapshot,
      renderSimulationResultsGraphic: async snapshot => new Blob([JSON.stringify(snapshot)]) };
    return {};
  } });
  const code = ts.transpileModule(readFileSync(new URL('../src/NFLSimulationResultsDownloads.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  const tree = context.exports.default({ games: scopes, stat: 'receptions' });
  const buttons = tree.props.children.find(node => node.type === 'div').props.children;
  const first = JSON.parse(await (await buttons[0].props.generate()).text());
  const second = JSON.parse(await (await buttons[0].props.generate()).text());
  assert.equal(first.record.wins, 2); assert.equal(second.record.wins, 1);
  const players = JSON.parse(await (await buttons[1].props.generate()).text());
  assert.equal(players.kind, 'players'); assert.equal(players.statistic, 'Receptions');
  assert.equal(players.rows[0].title, 'Receiver'); assert.equal(players.record.wins, 1);
  assert.equal(calls, 3);
  effects[0]()();
});
