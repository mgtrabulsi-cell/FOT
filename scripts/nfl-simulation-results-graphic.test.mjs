import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as accuracy from '../supabase/functions/_shared/nflSimulationAccuracy.ts';
import * as simulation from '../supabase/functions/_shared/nflSimulation.ts';
import { readNFLClosingSpread } from '../src/services/nflClosingSpread.ts';

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
      labels.push({ value, left, right: left + width, y, font: this.font });
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
  assert.ok(drawn.includes('Sim'));
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
  assert.equal(h.panels.filter(panel => panel.width === 182 && panel.height === 96).length, 3);
  assert.ok(h.drawn.includes('ACTUAL'));
  assert.ok(h.drawn.includes('AWY 21 - HOM 28'));
  assert.ok(h.drawn.includes('AWY 24 - HOM 24'));
  assert.equal(h.drawn.filter(value => value === 'Sim').length, 3);
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
  let graphicAccess = true;
  const context = vm.createContext({ exports: {}, AbortController, Error, console: { error: (...args) => errors.push(args) }, require(name) {
    if (name === 'react') return { useRef: () => ({ current: new Set() }), useEffect: fn => effects.push(fn) };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.includes('GamewaireResultsDownload')) return { ResultsGraphicDownload: 'Download' };
    if (name.includes('useSimulationGraphicAccess')) return { useSimulationGraphicAccess: () => ({ allowed: graphicAccess, error: '' }) };
    if (name.includes('nflClosingSpread')) return { fetchNFLClosingSpread: async game =>
      ['1', '2'].includes(game.eventId) ? closingFor([game], -6.5)[0] : null };
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
      simulationPlayerSummarySnapshot: h.simulationPlayerSummarySnapshot,
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
  const winnerButton = slateTree.props.children.find(node => node.type === 'div').props.children[4];
  const winners = JSON.parse(await (await winnerButton.props.generate()).text());
  assert.equal(winners.kind, 'winners');
  assert.equal(winners.rows.length, 4);
  assert.equal(winners.pending, 1); assert.equal(winners.excluded, 1);
  assert.equal(winners.record.wins, 1); assert.equal(winners.record.losses, 1);
  assert.equal(calls, 6);
  assert.match(winnerButton.props.filename, /Full-Slate-Winners\.png$/);
  const categoryButton = slateTree.props.children.find(node => node.type === 'div').props.children[5];
  const categories = JSON.parse(await (await categoryButton.props.generate()).text());
  assert.equal(categories.kind, 'player-summary');
  assert.equal(categories.sections.length, 4);
  assert.equal(categories.sections[1].rows[0].title, 'Receiver');
  assert.equal(categories.record.wins, 1);
  assert.equal(calls, 7);
  assert.match(categoryButton.props.filename, /Player-Top-3-Categories\.png$/);
  graphicAccess = false;
  assert.equal(context.exports.default({ games: scopes, stat: 'receptions' }), null);
  assert.equal(calls, 7, 'Public viewers cannot mount or generate the weekly download controls');
  effects[0]()();
});

const slateGame = (id, homeScore = 30, awayScore = 20, status = 'FINAL') => ({
  eventId: id, date: '2026-11-08T18:00:00Z', status,
  home: { id: '1', abbr: 'HOM', name: 'Home Team', color: '#2366aa', score: homeScore },
  away: { id: '2', abbr: 'AWY', name: 'Away Team', color: '#b42145', score: awayScore },
});
const closingFor = (games, homeLine = -6) => games.map(game => ({ eventId: game.eventId, kickoff: game.date,
  homeTeamId: game.home.id, awayTeamId: game.away.id, homeLine, awayLine: -homeLine, provider: 'DraftKings' }));
const savedForecast = (game, home, away) => ({
  eventId: game.eventId, kickoff: game.date, status: 'ready', qbMatchup: { scenarioId: 'published' },
  scenarios: [{ id: 'alternative', home: { score: { mean: 99 } }, away: { score: { mean: 0 } } },
    { id: 'published', home: { score: { mean: home } }, away: { score: { mean: away } } }],
});
test('Full slate grades closing ATS lines, including losses, exact pushes, away picks and pending/unavailable games', () => {
  const h = graphicHarness();
  const games = [slateGame('1', 31, 20), slateGame('2', 24, 20), slateGame('3', 26, 20),
    slateGame('4', 20, 30), slateGame('5', 20, 24), slateGame('6', 10, 10, 'LIVE'), slateGame('7', 0, 0, 'UPCOMING'),
    slateGame('8'), slateGame('9')];
  const forecasts = games.slice(0, 7).map(game => ({ eventId: game.eventId,
    forecast: savedForecast(game, ['4', '5'].includes(game.eventId) ? 20 : 27, ['4', '5'].includes(game.eventId) ? 27 : 20) }));
  forecasts.push({ eventId: '9', forecast: savedForecast(games[8], 24, 24) });
  const lines = closingFor(games).map(line => ['4', '5'].includes(line.eventId)
    ? { ...line, homeLine: 6, awayLine: -6 } : line);
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], pending: 0, issues: [] }, games, forecasts, now, 'slate', lines);
  assert.deepEqual(Array.from(snapshot.rows, row => row.spread.grade), ['covered', 'missed', 'push', 'covered', 'missed', 'pending', 'pending', 'unavailable', 'unavailable']);
  assert.equal(snapshot.rows[0].simulated, '20 - 27');
  assert.equal(snapshot.rows[0].spread.actualMargin, 5);
  assert.equal(snapshot.rows[3].spread.favorite, 'AWY');
  assert.equal(snapshot.rows[3].spread.actualMargin, 4);
  assert.equal(snapshot.rows[8].simulated, 'Unavailable', 'Never fabricate a winner from a tied archive');
  assert.equal(snapshot.verified, 5); assert.equal(snapshot.pending, 2); assert.equal(snapshot.excluded, 2);
  assert.deepEqual({ ...snapshot.record }, { wins: 2, losses: 2, ties: 1, noWinner: 2 });
  assert.throws(() => h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [games[0], games[0]], [], now), /unique NFL slate/);
  games[0].home.score = NaN;
  assert.throws(() => h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, games, forecasts, now), /Valid published/);
});
test('A sixteen-game export keeps every row and explicit colored grades within its adaptive canvas', async () => {
  const h = graphicHarness();
  const games = Array.from({ length: 16 }, (_, index) => slateGame(String(index).padStart(2, '0'), index % 3 === 0 ? 28 : index % 3 === 1 ? 24 : 26, 20));
  const forecasts = games.map(game => ({ eventId: game.eventId, forecast: savedForecast(game, 27, 20) }));
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], issues: [], pending: 0 }, games, forecasts, now, 'slate', closingFor(games));
  await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(snapshot.rows.length, 16);
  assert.equal(h.canvas.width, 1080); assert.equal(h.canvas.height, Math.round(2030 * 1080 / 768));
  assert.equal(h.drawn.filter(text => text === 'HOM -6').length, 16);
  for (const [label, color] of [['WIN', '#35d48a'], ['LOSS', '#ff2347'], ['PUSH', '#36baff']])
    assert.ok(h.coloredText.some(text => text.value === label && text.color === color));
  const cards = h.panels.filter(panel => panel.width === 708 && panel.height === 88);
  assert.equal(cards.length, 16);
  for (let index = 1; index < cards.length; index++) assert.ok(cards[index].y > cards[index - 1].y + cards[index - 1].height);
  assert.ok(h.drawn.some(text => text.includes('No invented odds')));
});
test('Modeled pregame OT is graded and labeled, but post-kickoff extensions and wrong-winner calls are never green', async () => {
  const h = graphicHarness(), game = slateGame('ot', 31, 27);
  const forecast = savedForecast(game, 27, 27);
  forecast.scenarios[1].projectedOvertime = { home: 30, away: 27, source: 'pregame' };
  const snapshot = h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast }], now, 'slate', closingFor([game], -2));
  assert.equal(snapshot.rows[0].simulated, '27 - 30 F/OT');
  assert.equal(snapshot.rows[0].spread.grade, 'covered');
  await h.renderSimulationResultsGraphic(snapshot);
  assert.ok(h.drawn.includes('F/OT'));
  forecast.scenarios[1].projectedOvertime.source = 'archive-extension';
  assert.equal(h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast }], now).rows[0].spread.grade, 'unavailable');
  game.home.score = 14; game.away.score = 21;
  const wrong = h.simulationSlateGraphicSnapshot({ games: [], issues: [] }, [game], [{ eventId: 'ot', forecast: savedForecast(game, 27, 20) }], now, 'slate', closingFor([game], -2));
  assert.equal(wrong.rows[0].spread.actualMargin, -9);
  assert.equal(wrong.rows[0].spread.grade, 'missed');
});
test('Result checkmarks occupy their own padded area below the score underline and left of the explanatory text', async () => {
  const h = graphicHarness(), snapshot = h.simulationResultsGraphicSnapshot(report(), scopes, 'games', 'passingYards', now);
  await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(h.circles.length, 3);
  h.circles.forEach((circle, index) => {
    const cardY = 300 + index * 178;
    assert.ok(circle.y - circle.radius >= cardY + 145);
    assert.ok(circle.y + circle.radius <= cardY + 165);
    const label = h.labels.find(row => row.value === snapshot.rows[index].difference && Math.abs(row.y - (cardY + 158)) < 1);
    assert.ok(label.left >= circle.x + circle.radius + 14);
    assert.ok(label.right < 546, 'Do not overlap the actual-score box');
  });
});
test('Winner-only slate grades wins regardless of spread, with actual ties, pending games and missing forecasts kept neutral', async () => {
  const h = graphicHarness();
  const games = [slateGame('1', 24, 20), slateGame('2', 27, 20), slateGame('3', 14, 21),
    slateGame('4', 20, 24), slateGame('5', 20, 20), slateGame('6', 10, 10, 'LIVE'),
    slateGame('7', 0, 0, 'UPCOMING'), slateGame('8')];
  const forecasts = games.slice(0, 7).map(game => ({ eventId: game.eventId,
    forecast: savedForecast(game, game.eventId === '4' ? 20 : 27, game.eventId === '4' ? 27 : 20) }));
  const report = { games: [], pending: 0, issues: [] };
  const winners = h.simulationSlateGraphicSnapshot(report, games, forecasts, now, 'winners');
  assert.deepEqual(Array.from(winners.rows, row => row.spread.grade), ['win', 'win', 'loss', 'win', 'tie', 'pending', 'pending', 'unavailable']);
  assert.deepEqual({ ...winners.record }, { wins: 3, losses: 1, ties: 1, noWinner: 1 });
  assert.equal(winners.verified, 5); assert.equal(winners.pending, 2); assert.equal(winners.excluded, 1);
  const spreads = h.simulationSlateGraphicSnapshot(report, games, forecasts, now, 'slate', closingFor(games));
  assert.equal(spreads.rows[0].spread.grade, 'missed');
  assert.equal(spreads.rows[1].spread.grade, 'covered');
  await h.renderSimulationResultsGraphic(winners);
  assert.equal(h.drawn.filter(text => text === 'WIN').length, 3);
  assert.ok(h.drawn.includes('3W - 1L - 1T'));
  assert.ok(h.drawn.includes('SIMULATED-WINNER RECORD'));
  assert.ok(h.coloredText.some(text => text.value === 'WIN' && text.color === '#35d48a'));
  assert.ok(h.coloredText.some(text => text.value === 'LOSS' && text.color === '#ff2347'));
  assert.ok(h.coloredText.some(text => text.value === 'TIE' && text.color === '#36baff'));
  assert.ok(!h.drawn.some(text => /spread|Actual margin:| -7|COVERED|MISSED|PUSH/i.test(text)));
});

test('Closing ATS selects the projected covering team, not the outright winner, and grades Tampa Bay +6.5 as a win', async () => {
  const h = graphicHarness(), game = slateGame('tb', 27, 24);
  game.home.abbr = 'CHI'; game.away.abbr = 'TB';
  const lines = closingFor([game], -6.5), report = { games: [], issues: [] };
  const forecast = savedForecast(game, 27, 24);
  const snapshot = h.simulationSlateGraphicSnapshot(report, [game], [{ eventId: 'tb', forecast }], now, 'slate', lines);
  assert.equal(snapshot.rows[0].spread.favorite, 'TB', 'Chicago is the outright projected winner but Tampa Bay is the ATS pick');
  assert.equal(snapshot.rows[0].spread.closingLine, 6.5);
  assert.equal(snapshot.rows[0].spread.actualMargin, 3.5);
  assert.equal(snapshot.rows[0].spread.grade, 'covered');
  assert.equal(snapshot.record.wins, 1);
  await h.renderSimulationResultsGraphic(snapshot);
  assert.ok(h.drawn.includes('TB +6.5'));
  assert.ok(h.drawn.includes('WIN'));
  assert.ok(h.drawn.includes('Close: DraftKings'));
  const chiPick = h.simulationSlateGraphicSnapshot(report, [game], [{ eventId: 'tb', forecast: savedForecast(game, 35, 24) }], now, 'slate', lines);
  assert.equal(chiPick.rows[0].spread.favorite, 'CHI');
  assert.equal(chiPick.rows[0].spread.grade, 'missed');
  const noLine = h.simulationSlateGraphicSnapshot(report, [game], [{ eventId: 'tb', forecast }], now);
  assert.equal(noLine.rows[0].spread.grade, 'unavailable');
  assert.equal(noLine.rows[0].simulated, '24 - 27', 'Keep the published score visible when the closing line is missing');
  assert.equal(noLine.verified, 0);
  const pushLines = closingFor([game], -3);
  const push = h.simulationSlateGraphicSnapshot(report, [game], [{ eventId: 'tb', forecast: savedForecast(game, 30, 24) }], now, 'slate', pushLines);
  assert.equal(push.rows[0].spread.grade, 'push');
  const noPick = h.simulationSlateGraphicSnapshot(report, [game], [{ eventId: 'tb', forecast }], now, 'slate', pushLines);
  assert.equal(noPick.rows[0].spread.grade, 'unavailable');
  assert.match(noPick.rows[0].difference, /No ATS pick/);
});

test('Closing reader accepts explicit finalized provider close fields only, never generic spreads, opening lines or in-play lines', () => {
  const game = slateGame('tb');
  const summary = { header: { id: 'tb', competitions: [{ date: game.date, status: { type: { state: 'post', completed: true } },
    competitors: [{ homeAway: 'home', team: { id: '1' } }, { homeAway: 'away', team: { id: '2' } }] }] },
    pickcenter: [{ provider: { name: 'DraftKings' }, spread: -99, pointSpread: {
      home: { close: { line: '-6.5' }, open: { line: '-3.5' } }, away: { close: { line: '+6.5' }, open: { line: '+3.5' } },
    } }] };
  assert.equal(readNFLClosingSpread(summary, game).homeLine, -6.5);
  assert.equal(readNFLClosingSpread(summary, game).awayLine, 6.5);
  summary.header.competitions[0].status.type.state = 'in';
  assert.equal(readNFLClosingSpread(summary, game), null);
  summary.header.competitions[0].status.type.state = 'post';
  delete summary.pickcenter[0].pointSpread.away.close;
  assert.equal(readNFLClosingSpread(summary, game), null);
  summary.pickcenter[0].pointSpread.away.close = { line: '+7.5' };
  assert.throws(() => readNFLClosingSpread(summary, game), /inconsistent/);
  summary.pickcenter[0].pointSpread.away.close.line = '+6.5';
  assert.equal(readNFLClosingSpread(summary, { ...game, nflMarket: { provider: 'Different book' } }), null);
  assert.throws(() => readNFLClosingSpread(summary, { ...game, eventId: 'wrong' }), /match the selected game/);
});

const playerLine = (playerId, stat, projected, actual, position = 'WR', name = playerId) =>
  ({ playerId, stat, projected, actual, position, name, team: 'HOM', error: Math.abs(projected - actual) });
function categoryReport() {
  const data = report();
  data.games[0].players = Array.from({ length: 4 }, (_, index) => [
    playerLine(`Passer ${index}`, 'passingYards', 250 + index * 5, 250, 'QB'),
    playerLine(`Receiver ${index}`, 'receptions', 5 + index, 5),
    playerLine(`Receiver ${index}`, 'receivingYards', 80 + index * 8, 80),
    playerLine(`Runner ${index}`, 'rushingYards', 70 + index * 3, 70, 'RB'),
    playerLine(`Scorer ${index}`, 'rushingTouchdowns', .4 + index * .1, 1, 'RB'),
    playerLine(`Scorer ${index}`, 'receivingTouchdowns', .6, 0, 'RB'),
  ]).flat();
  return data;
}
test('Four-section player snapshot includes exactly three per category, paired receiving stats and combined rushing/receiving TDs', async () => {
  const h = graphicHarness(), data = categoryReport();
  const snapshot = h.simulationPlayerSummarySnapshot(data, scopes, now);
  assert.equal(snapshot.kind, 'player-summary'); assert.equal(snapshot.sections.length, 4);
  assert.equal(snapshot.rows.length, 12);
  assert.deepEqual(Array.from(snapshot.sections, section => section.rows.length), [3, 3, 3, 3]);
  assert.equal(snapshot.sections[0].rows[0].title, 'Passer 0');
  assert.equal(snapshot.sections[1].rows[1].difference, '15.0% mean absolute percentage error');
  assert.equal(snapshot.sections[1].rows[0].simulated, '5 REC | 80 YD');
  assert.equal(snapshot.sections[1].rows[0].actual, '5 REC | 80 YD');
  assert.equal(snapshot.sections[2].rows[0].title, 'Runner 0');
  assert.equal(snapshot.sections[3].rows[0].simulated, '1 TD');
  assert.equal(snapshot.sections[3].rows[0].actual, '1 TD');
  assert.equal(snapshot.record.wins, 2); assert.equal(snapshot.verified, 5);
  data.games[0].players[0].projected = 999;
  assert.equal(snapshot.sections[0].rows[0].simulated, '250 YD', 'Freeze copied stat strings');
  await h.renderSimulationResultsGraphic(snapshot);
  assert.equal(h.canvas.width, 1080);
  assert.equal(h.canvas.height, Math.round((415 + 4 * (80 + 3 * 158)) * 1080 / 768));
  assert.equal(h.panels.filter(panel => panel.width === 708 && panel.height === 148).length, 12);
  assert.ok(h.drawn.includes('RECEPTIONS + RECEIVING YARDS - TOP 3'));
  assert.ok(h.drawn.includes('RUSHING + RECEIVING TOUCHDOWNS - TOP 3'));
  assert.equal(h.drawn.filter(value => value === 'Sim').length, 12);
  assert.ok(h.drawn.includes('5 REC')); assert.ok(h.drawn.includes('80 YD'));
});
test('Combined receiving ranks mean percentage error, and cannot pair different players, games, teams or ambiguous rows', () => {
  const h = graphicHarness(), data = report();
  data.games.forEach(game => { game.players = []; });
  data.games[0].players = [
    playerLine('A', 'receptions', 11, 10), playerLine('A', 'receivingYards', 210, 200),
    playerLine('B', 'receptions', 6, 5), playerLine('B', 'receivingYards', 41, 40),
    playerLine('missing', 'receptions', 5, 5),
    playerLine('low yards', 'receptions', 5, 5), playerLine('low yards', 'receivingYards', 29.99, 30),
    playerLine('low catches', 'receptions', 3, 2.99), playerLine('low catches', 'receivingYards', 30, 30),
    playerLine('duplicate', 'receptions', 5, 5), playerLine('duplicate', 'receptions', 5, 5), playerLine('duplicate', 'receivingYards', 80, 80),
    playerLine('mismatch', 'receptions', 5, 5), playerLine('mismatch', 'receivingYards', 80, 80, 'WR', 'Different name'),
    playerLine('team mismatch', 'receptions', 5, 5), { ...playerLine('team mismatch', 'receivingYards', 80, 80), team: 'AWY' },
  ];
  data.games[1].players = [playerLine('missing', 'receivingYards', 80, 80)];
  const snapshot = h.simulationPlayerSummarySnapshot(data, scopes, now);
  assert.deepEqual(Array.from(snapshot.sections[1].rows, row => row.title), ['A', 'B']);
  assert.equal(snapshot.sections[1].rows[0].difference, '7.5% mean absolute percentage error');
  assert.equal(snapshot.sections[0].rows.length, 0);
  assert.equal(snapshot.sections[3].rows.length, 0);
});
test('Category minimums preserve QB/yard thresholds and require both touchdown components without filling missing zeroes', async () => {
  const h = graphicHarness(), data = report();
  data.games.forEach(game => { game.players = []; });
  data.games[0].players = [
    playerLine('QB exact', 'passingYards', 200, 200, 'QB'),
    playerLine('QB low', 'passingYards', 199.99, 200, 'QB'),
    playerLine('not QB', 'passingYards', 250, 250, 'WR'),
    playerLine('rush exact', 'rushingYards', 30, 30, 'QB'),
    playerLine('rush low', 'rushingYards', 30, 29.99, 'RB'),
    playerLine('missing TD', 'receivingTouchdowns', 1, 1),
    playerLine('low TD', 'rushingTouchdowns', .49, 0), playerLine('low TD', 'receivingTouchdowns', .5, 1),
    playerLine('passing only', 'passingTouchdowns', 3, 3, 'QB'),
    playerLine('exact TD', 'rushingTouchdowns', .4, 0), playerLine('exact TD', 'receivingTouchdowns', .6, 1),
  ];
  const snapshot = h.simulationPlayerSummarySnapshot(data, scopes, now);
  assert.equal(snapshot.sections[0].rows[0].title, 'QB exact');
  assert.equal(snapshot.sections[2].rows[0].title, 'rush exact');
  assert.equal(snapshot.sections[3].rows.length, 1);
  assert.equal(snapshot.sections[3].rows[0].title, 'exact TD');
  await h.renderSimulationResultsGraphic(snapshot);
  assert.ok(h.drawn.includes('RECEPTIONS + RECEIVING YARDS - TOP 0'));
  assert.ok(h.drawn.some(text => text.startsWith('No verified players meet')));
  data.games[0].players = [];
  assert.throws(() => h.simulationPlayerSummarySnapshot(data, scopes, now), /No verified players/);
});

test('Player-category displays round each stat and summed touchdowns, without rounding ranking errors or minimums', () => {
  const h = graphicHarness(), data = report();
  data.games.forEach(game => { game.players = []; });
  data.games[0].players = [
    playerLine('lower error', 'passingYards', 250.49, 250, 'QB'),
    playerLine('higher error', 'passingYards', 250.51, 250, 'QB'),
    playerLine('below minimum', 'passingYards', 199.99, 200, 'QB'),
    playerLine('receiver', 'receptions', 5.51, 5), playerLine('receiver', 'receivingYards', 80.49, 80),
    playerLine('runner', 'rushingYards', 49.5, 50, 'RB'),
    playerLine('scorer', 'rushingTouchdowns', .6, 1), playerLine('scorer', 'receivingTouchdowns', .6, 0),
  ];
  const snapshot = h.simulationPlayerSummarySnapshot(data, scopes, now);
  assert.deepEqual(Array.from(snapshot.sections[0].rows, row => row.title), ['lower error', 'higher error']);
  assert.equal(snapshot.sections[0].rows[0].simulated, '250 YD');
  assert.equal(snapshot.sections[0].rows[1].simulated, '251 YD');
  assert.equal(snapshot.sections[0].rows[0].difference, '0.5 yard difference');
  assert.equal(snapshot.sections[1].rows[0].simulated, '6 REC | 80 YD');
  assert.equal(snapshot.sections[2].rows[0].simulated, '50 YD');
  assert.equal(snapshot.sections[3].rows[0].simulated, '1 TD', 'Round the summed mean, not each component before adding');
  assert.equal(snapshot.sections[3].rows[0].difference, '0.2 TD difference');
  assert.ok(snapshot.rows.every(row => !/\d+\.\d+/.test(row.simulated)));
});

test('Every simulation-result graphic uses the same label font and natural word space, with padded stat baselines', async () => {
  for (const kind of ['games', 'players', 'performances', 'player-summary', 'slate', 'winners']) {
    const h = graphicHarness(), data = categoryReport();
    data.games[0].players.push(playerLine('performer', 'receptions', 5, 5),
      playerLine('performer', 'receivingYards', 60, 60), playerLine('performer', 'receivingTouchdowns', .5, 1));
    const games = [slateGame('1')];
    const snapshot = kind === 'player-summary' ? h.simulationPlayerSummarySnapshot(data, scopes, now)
      : kind === 'slate' || kind === 'winners' ? h.simulationSlateGraphicSnapshot(data, games, [], now, kind, closingFor(games))
      : h.simulationResultsGraphicSnapshot(data, scopes, kind, 'passingYards', now);
    await h.renderSimulationResultsGraphic(snapshot);
    const labels = h.labels.filter(label => label.value === 'Sim');
    assert.ok(labels.length > 0, kind);
    for (const label of labels) {
      assert.equal(label.font, 'italic 700 14px "DM Sans"');
      const ending = h.labels.find(candidate => candidate.value === 're' && candidate.y === label.y);
      assert.ok(Math.abs(label.left - ending.right - 14 * .55) < 1e-9, `${kind}: use one measured word space`);
    }
    if (kind === 'slate' || kind === 'winners') continue;
    const first = labels[0], simulated = h.labels.find(label => label.left < 540 && label.value === (kind === 'games'
      ? `${snapshot.rows[0].away} ${snapshot.rows[0].simulated.replace(' - ', ` - ${snapshot.rows[0].home} `)}`
      : snapshot.rows[0].simulated));
    assert.ok(simulated.y - first.y >= 36, `${kind}: leave space between the caption and its value`);
  }
});
