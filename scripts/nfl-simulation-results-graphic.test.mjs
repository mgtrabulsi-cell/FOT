import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as accuracy from '../supabase/functions/_shared/nflSimulationAccuracy.ts';
import * as simulation from '../supabase/functions/_shared/nflSimulation.ts';

const now = Date.parse('2026-11-08T23:00:00Z');
const scopes = [{ date: '2026-11-05T23:00:00Z' }, { date: '2026-11-09T23:00:00Z' }];
const result = (id, projectedHome, projectedAway, actualHome, actualAway, error = 0) => ({
  eventId: id, kickoff: '2026-11-08T18:00:00Z', error, home: { name: 'Home Team', abbr: 'HOM', projected: projectedHome, actual: actualHome },
  away: { name: 'Away Team', abbr: 'AWY', projected: projectedAway, actual: actualAway }, players: [],
});
const report = () => ({
  pending: 2, issues: ['Missing archive'],
  games: [result('1', 28, 21, 28, 21, 0), result('2', 21, 24, 21, 24, 0),
    result('3', 28, 24, 21, 24, 3.5), result('4', 24, 21, 24, 24, 1.5), result('5', 22.4, 22.2, 20, 17, 3.5)],
});
function graphicHarness() {
  const drawn = [], fontSizes = [], panels = [], scales = [], coloredText = [], accents = [], circles = [], labels = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({
    createLinearGradient: () => gradient,
    scale: (x, y) => scales.push([x, y]),
    roundRect: (x, y, width, height) => panels.push({ x, y, width, height }),
    arc: (x, y, radius) => circles.push({ x, y, radius }),
    fillRect(x, y, width) { if (x === 30 && width === 8) accents.push(this.fillStyle); },
    measureText(value) { return { width: value.length * Number(this.font.match(/(\d+)px/)[1]) * .55 }; },
    fillText(value, x, y) {
      const width = this.measureText(value).width;
      const left = this.textAlign === 'center' ? x - width / 2 : x;
      assert.ok(left >= 0 && left + width <= 768 && y > 0 && y < canvas.height * 768 / 1080);
      labels.push({ value, left, right: left + width, y });
      drawn.push(value); fontSizes.push(this.font); coloredText.push({ value, color: this.fillStyle });
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    toBlob(callback, type) { assert.equal(type, 'image/png'); callback(new Blob(['png'], { type })); } };
  const context = vm.createContext({ exports: {}, Intl, Date, Math, Number, Error, Blob,
    document: { createElement: () => canvas }, require(name) {
      if (name.includes('gamewaireResultsGraphic')) return { loadGamewireGraphicAssets: async () => ({ naturalWidth: 400, naturalHeight: 400 }) };
      if (name.includes('nflSimulationAccuracy')) return accuracy;
      if (name.includes('nflSimulation')) return simulation;
      return {};
    } });
  const code = ts.transpileModule(readFileSync(new URL('../src/services/nflSimulationResultsGraphic.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  return { ...context.exports, canvas, drawn, fontSizes, panels, scales, coloredText, accents, circles, labels };
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
  data.games[0].overtime = true;
  assert.match(simulationResultsGraphicSnapshot(data, scopes, 'games', 'passingYards', now).rows[0].simulated, / F\/OT$/);
});
test('Player graphic uses only qualifying selected-stat results and preserves the overall game winner record', async () => {
  const { simulationResultsGraphicSnapshot, renderSimulationResultsGraphic, drawn } = graphicHarness(), data = report();
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
  await renderSimulationResultsGraphic(snapshot);
  assert.ok(drawn.includes('PASSING YARDS'));
  assert.ok(drawn.includes('250.0'));
  assert.ok(drawn.includes('re Sim'));
  assert.ok(drawn.includes('Sim & actual >= 200'));
});
test('Instagram PNG is portrait, contains the current record and timestamp, and exports explicit errors', async () => {
  const h = graphicHarness(), snapshot = h.simulationResultsGraphicSnapshot(report(), scopes, 'games', 'passingYards', now);
  const blob = await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(blob.type, 'image/png'); assert.equal(h.canvas.width, 1080); assert.equal(h.canvas.height, 1350);
  assert.ok(h.drawn.includes('TOP 3 GAME SIMULATIONS'));
  assert.ok(h.drawn.includes('2W - 1L - 1T'));
  assert.ok(h.drawn.some(text => /Downloaded .* ET/.test(text)));
  assert.ok(h.drawn.some(text => /1 no winner forecast/.test(text)));
  assert.deepEqual(h.scales[0], [1080 / 768, 1350 / 960]);
  assert.equal(h.panels.filter(panel => panel.width === 182 && panel.height === 77).length, 3);
  assert.ok(h.drawn.includes('ACTUAL'));
  assert.ok(h.drawn.includes('AWY 21 - HOM 28'));
  assert.ok(h.drawn.includes('AWY 24 - HOM 24'));
  assert.equal(h.drawn.filter(value => value === 're Sim').length, 3);
  assert.equal(h.coloredText.filter(({ value, color }) => value === 'AI' && color === '#ff2347').length, 4);
  assert.deepEqual(h.accents, ['#06caff', '#35d48a', '#35d48a', '#35d48a']);
  assert.ok(h.fontSizes.some(font => font.startsWith('italic')));
  h.canvas.toBlob = callback => callback(null);
  await assert.rejects(h.renderSimulationResultsGraphic(snapshot), /export the Instagram PNG/);
  assert.throws(() => h.simulationResultsGraphicSnapshot({ games: [], issues: [], pending: 0 }, scopes, 'games', 'passingYards', now), /No verified game/);
  assert.throws(() => h.simulationResultsGraphicSnapshot(report(), scopes, 'players', 'passingYards', now), /No player simulations/);
});
test('Full-performance PNG snapshots three complete receiving lines, fresh overall record, and honest qualification labels', async () => {
  const h = graphicHarness(), data = report();
  data.games[0].players = Array.from({ length: 4 }, (_, i) => [
    { stat: 'receptions', projected: 5, actual: 7 },
    { stat: 'receivingYards', projected: 130, actual: 60 + i },
    { stat: 'receivingTouchdowns', projected: .5, actual: 1 },
  ].map(row => ({ ...row, playerId: String(i), name: `Receiver ${i}`, position: 'WR', team: 'HOM', error: Math.abs(row.projected - row.actual) }))).flat();
  const snapshot = h.simulationResultsGraphicSnapshot(data, scopes, 'performances', 'passingYards', now);
  assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.rows[0].title, 'Receiver 3');
  assert.equal(snapshot.rows[0].simulated, '5.0 REC | 130.0 YD | 0.5 TD');
  assert.equal(snapshot.rows[0].actual, '7 REC | 63 YD | 1 TD');
  assert.equal(snapshot.record.wins, 2);
  data.games[0].players[0].projected = 999;
  assert.equal(snapshot.rows[0].simulated, '5.0 REC | 130.0 YD | 0.5 TD');
  const blob = await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(blob.type, 'image/png');
  for (const text of ['3 FULL PLAYER PERFORMANCES', '7 REC', '63 YD', '1 TD',
    'Both: 60+ YD / 5+ REC', 'TD: sim 0.5+ / actual 1+', 'Receiving performance call matched']) assert.ok(h.drawn.includes(text), text);
  assert.ok(h.drawn.some(text => text.includes('not exact accuracy')));
  assert.throws(() => h.simulationResultsGraphicSnapshot(report(), scopes, 'performances', 'receptions', now), /all three receiving-performance criteria/);
});
test('Each download refreshes the entire selected week and uses the fresh winner record rather than cached UI results', async () => {
  const h = graphicHarness(), effects = [], requests = [], fetched = [], errors = [];
  let calls = 0;
  let selectedGames = scopes;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, AbortController, Error, console: { error: (...args) => errors.push(args) }, require(name) {
    if (name === 'react') return { useRef: () => ({ current: new Set() }), useEffect: fn => effects.push(fn) };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('GamewaireResultsDownload')) return { ResultsGraphicDownload: 'Download' };
    if (name.includes('gamewireBot')) return { loadSimulationAccuracy: async (games, signal) => {
      assert.equal(games, selectedGames); assert.equal(signal.aborted, false); requests.push(signal); calls++;
      const data = report();
      if (calls > 1) data.games[0].home.actual = 14;
      data.games[0].players = [
        { stat: 'receptions', projected: 5, actual: 5 },
        { stat: 'receivingYards', projected: 100, actual: 60 },
        { stat: 'receivingTouchdowns', projected: .5, actual: 1 },
      ].map(row => ({ ...row, playerId: '1', name: 'Receiver', position: 'WR', team: 'HOM', error: Math.abs(row.projected - row.actual) }));
      return data;
    }, loadGameSimulation: async (game, signal) => {
      assert.equal(signal.aborted, false); fetched.push(game.eventId);
      if (game.eventId === 'missing') throw new Error('Feed interruption');
      return savedForecast(game, 27, 20);
    } };
    if (name.includes('nflSimulationResultsGraphic')) return { simulationResultsGraphicSnapshot: h.simulationResultsGraphicSnapshot,
      simulationSlateGraphicSnapshot: h.simulationSlateGraphicSnapshot,
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
  const performances = JSON.parse(await (await buttons[2].props.generate()).text());
  assert.equal(performances.kind, 'performances');
  assert.equal(performances.rows[0].simulated, '5.0 REC | 100.0 YD | 0.5 TD');
  assert.equal(performances.record.wins, 1);
  assert.equal(calls, 4);
  selectedGames = [slateGame('1'), slateGame('2'), slateGame('pending', 0, 0, 'UPCOMING'), slateGame('missing')];
  const slateTree = context.exports.default({ games: selectedGames, stat: 'receptions' });
  const slateButton = slateTree.props.children.find(node => node.type === 'div').props.children[3];
  const slate = JSON.parse(await (await slateButton.props.generate()).text());
  assert.equal(slate.kind, 'slate'); assert.equal(slate.rows.length, 4);
  assert.deepEqual(fetched.sort(), ['missing', 'pending']);
  assert.equal(slate.pending, 1); assert.equal(slate.excluded, 1); assert.equal(errors.length, 1);
  assert.equal(calls, 5);
  effects[0]()();
});

const slateGame = (id, homeScore = 30, awayScore = 20, status = 'FINAL') => ({
  eventId: id, date: '2026-11-08T18:00:00Z', status,
  home: { abbr: 'HOM', name: 'Home Team', color: '#2366aa', score: homeScore },
  away: { abbr: 'AWY', name: 'Away Team', color: '#b42145', score: awayScore },
});
const savedForecast = (game, home, away) => ({
  eventId: game.eventId, kickoff: game.date, status: 'ready', qbMatchup: { scenarioId: 'published' },
  scenarios: [{ id: 'alternative', home: { score: { mean: 99 } }, away: { score: { mean: 0 } } },
    { id: 'published', home: { score: { mean: home } }, away: { score: { mean: away } } }],
});
test('Full slate grades the selected published spread, including losses, exact pushes, away favorites and pending/unavailable games', () => {
  const h = graphicHarness();
  const games = [slateGame('1', 31, 20), slateGame('2', 24, 20), slateGame('3', 27, 20),
    slateGame('4', 20, 30), slateGame('5', 20, 24), slateGame('6', 10, 10, 'LIVE'), slateGame('7', 0, 0, 'UPCOMING'),
    slateGame('8'), slateGame('9')];
  const forecasts = games.slice(0, 7).map(game => ({ eventId: game.eventId,
    forecast: savedForecast(game, ['4', '5'].includes(game.eventId) ? 20 : 27, ['4', '5'].includes(game.eventId) ? 27 : 20) }));
  forecasts.push({ eventId: '9', forecast: savedForecast(games[8], 24, 24) });
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], pending: 0, issues: [] }, games, forecasts, now);
  assert.deepEqual(Array.from(snapshot.rows, row => row.spread.grade), ['covered', 'missed', 'push', 'covered', 'missed', 'pending', 'pending', 'unavailable', 'unavailable']);
  assert.equal(snapshot.rows[0].simulated, '20 - 27');
  assert.equal(snapshot.rows[0].spread.actualMargin, 11);
  assert.equal(snapshot.rows[3].spread.favorite, 'AWY');
  assert.equal(snapshot.rows[3].spread.actualMargin, 10);
  assert.equal(snapshot.rows[8].simulated, 'Unavailable', 'Never fabricate a winner from a tied archive');
  assert.equal(snapshot.verified, 5); assert.equal(snapshot.pending, 2); assert.equal(snapshot.excluded, 2);
  assert.deepEqual({ ...snapshot.record }, { wins: 2, losses: 2, ties: 1, noWinner: 2 });
  assert.throws(() => h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [games[0], games[0]], [], now), /unique NFL slate/);
  games[0].home.score = NaN;
  assert.throws(() => h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, games, forecasts, now), /Valid published/);
});
test('A sixteen-game export keeps every row and explicit colored grades within its adaptive canvas', async () => {
  const h = graphicHarness();
  const games = Array.from({ length: 16 }, (_, index) => slateGame(String(index).padStart(2, '0'), index % 3 === 0 ? 28 : index % 3 === 1 ? 24 : 27, 20));
  const forecasts = games.map(game => ({ eventId: game.eventId, forecast: savedForecast(game, 27, 20) }));
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], issues: [], pending: 0 }, games, forecasts, now);
  await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(snapshot.rows.length, 16);
  assert.equal(h.canvas.width, 1080); assert.equal(h.canvas.height, Math.round(2030 * 1080 / 768));
  assert.equal(h.drawn.filter(text => text === 'HOM -7').length, 16);
  for (const [label, color] of [['COVERED', '#35d48a'], ['MISSED', '#ff2347'], ['PUSH', '#36baff']])
    assert.ok(h.coloredText.some(text => text.value === label && text.color === color));
  const cards = h.panels.filter(panel => panel.width === 708 && panel.height === 88);
  assert.equal(cards.length, 16);
  for (let index = 1; index < cards.length; index++) assert.ok(cards[index].y > cards[index - 1].y + cards[index - 1].height);
  assert.ok(h.drawn.some(text => text.includes('not sportsbook odds')));
});
test('Modeled pregame OT is graded and labeled, but post-kickoff extensions and wrong-winner calls are never green', async () => {
  const h = graphicHarness(), game = slateGame('ot', 31, 27);
  const forecast = savedForecast(game, 27, 27);
  forecast.scenarios[1].projectedOvertime = { home: 30, away: 27, source: 'pregame' };
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast }], now);
  assert.equal(snapshot.rows[0].simulated, '27 - 30 F/OT');
  assert.equal(snapshot.rows[0].spread.grade, 'covered');
  await h.renderSimulationResultsGraphic(snapshot);
  assert.ok(h.drawn.includes('F/OT'));
  forecast.scenarios[1].projectedOvertime.source = 'archive-extension';
  assert.equal(h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast }], now).rows[0].spread.grade, 'unavailable');
  game.home.score = 14; game.away.score = 21;
  const wrong = h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast: savedForecast(game, 27, 20) }], now);
  assert.equal(wrong.rows[0].spread.actualMargin, -7);
  assert.equal(wrong.rows[0].spread.grade, 'missed');
});
test('Result checkmarks occupy their own padded area below the score underline and left of the explanatory text', async () => {
  const h = graphicHarness(), snapshot = h.simulationResultsGraphicSnapshot(report(), scopes, 'games', 'passingYards', now);
  await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(h.circles.length, 3);
  h.circles.forEach((circle, index) => {
    const cardY = 300 + index * 178;
    assert.ok(circle.y - circle.radius >= cardY + 139);
    assert.ok(circle.y + circle.radius <= cardY + 160);
    const label = h.labels.find(row => row.value === snapshot.rows[index].difference && Math.abs(row.y - (cardY + 153)) < 1);
    assert.ok(label.left >= circle.x + circle.radius + 14);
    assert.ok(label.right < 546, 'Do not overlap the actual-score box');
  });
});
