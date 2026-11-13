import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as engine from '../supabase/functions/_shared/gamewaire.ts';
import * as picks from '../src/services/anglePicks.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const now = Date.parse('2026-11-13T23:00:00Z'), kickoff = '2026-11-13T01:15:00Z';
const game = { id: 'NFL:401873052', eventId: '401873052', date: kickoff, league: 'NFL', status: 'FINAL', seasonYear: 2026,
  venue: 'MetLife Stadium', away: { id: '28', name: 'Washington Commanders', abbr: 'WSH' },
  home: { id: '19', name: 'New York Giants', abbr: 'NYG' } };
const summary = () => ({
  header: { id: game.eventId, week: 10, competitions: [{ date: kickoff, status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitors: [
      { homeAway: 'home', score: '21', team: { id: '19', displayName: 'New York Giants', name: 'Giants', abbreviation: 'NYG' } },
      { homeAway: 'away', score: '24', team: { id: '28', displayName: 'Washington Commanders', name: 'Commanders', abbreviation: 'WSH' } },
    ] }] },
  boxscore: { players: [
    { team: { id: '28' }, statistics: [
      { keys: ['rushingYards', 'rushingTouchdowns'], athletes: [{ athlete: { id: '1', displayName: 'Jayden Daniels', shortName: 'J. Daniels' }, stats: ['38', '0'] }] },
      { keys: ['passingTouchdowns'], athletes: [{ athlete: { id: '1', displayName: 'Jayden Daniels', shortName: 'J. Daniels' }, stats: ['2'] }] },
      { keys: ['receivingYards', 'receptions', 'receivingTouchdowns'], athletes: [
        { athlete: { id: '2', displayName: 'Terry McLaurin', shortName: 'T. McLaurin' }, stats: ['84', '6', '1'] },
      ] },
    ] },
    { team: { id: '19' }, statistics: [{ keys: ['receivingYards', 'receptions', 'receivingTouchdowns'], athletes: [
      { athlete: { id: '3', displayName: 'Malik Nabers', shortName: 'M. Nabers' }, stats: ['70', '5', '0'] },
    ] }] },
  ] },
});
const story = (texts, extra = {}) => ({ id: 'story', game_id: game.id, season: 2026, week: 10, status: 'published',
  published_at: '2026-11-12T12:00:00Z', pick: '', picks: texts.map((text, i) => ({ id: String(i), text, result: 'pending' })), ...extra });
const comparison = () => ({ eventId: game.eventId, kickoff, forecastAt: '2026-11-12T23:00:00Z', issues: [],
  away: { ...game.away, projected: 25, actual: 24 }, home: { ...game.home, projected: 21, actual: 21 },
  players: [
    { playerId: '2', name: 'Terry McLaurin', team: 'WSH', stat: 'rushingTouchdowns', projected: .1, actual: 0, error: .1 },
    { playerId: '2', name: 'Terry McLaurin', team: 'WSH', stat: 'receivingTouchdowns', projected: .7, actual: 1, error: .3 },
    { playerId: '2', name: 'Terry McLaurin', team: 'WSH', stat: 'receivingYards', projected: 80, actual: 84, error: 4 },
    { playerId: '3', name: 'Malik Nabers', team: 'NYG', stat: 'receivingYards', projected: 30, actual: 70, error: 40 },
  ] });
function moduleFrom(path, require, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8').replace('import.meta.env.BASE_URL', "'/'"),
    { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, Date, Intl, Number, Math, Error, Set, Map, setTimeout, clearTimeout, console, require, ...globals });
  vm.runInContext(code, context);
  return context.exports;
}
const recap = moduleFrom('../src/services/nflSimulationRecap.ts', name => {
  if (name.includes('anglePicks')) return picks;
  if (name.includes('gamewaire')) return engine;
  throw new Error(name);
});
const snapshot = (stories = [story(['McLaurin TD', 'Commanders +3.5', 'J. Daniels over 40.5 rushing yards', 'Over 45'])]) =>
  recap.simulationRecapSnapshot(game, summary(), stories, undefined, [], now);

test('A per-game recap verifies the final identity, normal completion, teams and scores', () => {
  for (const change of [
    data => data.header.id = 'other',
    data => data.header.competitions[0].date = '2026-11-14T01:15:00Z',
    data => data.header.competitions[0].status.type.completed = false,
    data => data.header.competitions[0].status.type.name = 'STATUS_CANCELED',
    data => data.header.competitions[0].competitors[0].team.id = 'other',
    data => data.header.competitions[0].competitors[0].score = '--',
  ]) {
    const data = summary(); change(data);
    assert.throws(() => recap.readRecapFinal(data, game), /verified|verified|recap/i);
  }
  assert.throws(() => recap.readRecapFinal(summary(), { ...game, status: 'LIVE' }), /final/i);
});
test('Posted picks include actual hits, misses and pushes without inventing causal explanations', () => {
  const result = snapshot();
  assert.deepEqual(Array.from(result.rows, row => row.grade), ['hit', 'hit', 'miss', 'push']);
  assert.equal(result.mode, 'admin');
  assert.match(result.rows[2].detail, /38 rushing yards/);
  assert.match(result.rows[3].detail, /Push/);
  assert.doesNotMatch(JSON.stringify(result), /kneel|perfect|all.*cashed/i);
  assert.match(result.analysis[0], /2 hit, 1 missed, 1 pushed/);
});
test('Missing statistics and DNPs are not zeros and passing TDs are not anytime TDs', () => {
  const final = recap.readRecapFinal(summary(), game);
  assert.equal(recap.gradeRecapPick('Daniels TD', final).grade, 'review');
  assert.equal(recap.gradeRecapPick('Nabers TD', final).grade, 'review');
  assert.equal(recap.gradeRecapPick('Daniels under 2.5 receptions', final).grade, 'review');
  assert.equal(recap.gradeRecapPick('Terry McLaurin 80+ receiving yards', final).grade, 'hit');
  assert.equal(recap.gradeRecapPick(`Commanders +${'9'.repeat(400)}`, final).grade, 'review');
  const data = summary(); data.boxscore.players[0].statistics[2].athletes[0].didNotPlay = true;
  assert.equal(recap.gradeRecapPick('Terry McLaurin over 20.5 receiving yards', recap.readRecapFinal(data, game)).grade, 'review');
});
test('Only pregame published game-matched picks qualify; general NFL posts require identifiable teams or full player identities', () => {
  const stories = [
    story(['Commanders +3.5']), story(['Giants ML'], { id: 'postgame', published_at: kickoff }),
    story(['Nabers TD'], { id: 'draft', status: 'draft' }), story(['Giants ML'], { id: 'other', game_id: 'NFL:other' }),
    story(['Giants ML'], { id: 'season', season: 2025 }),
    story(['Jayden Daniels over 40.5 rushing yards'], { id: 'old-week', game_id: 'NFL:0', week: 9 }),
    story(['Jayden Daniels over 40.5 rushing yards', 'Diggs TD', 'Over 45'], { id: 'general', game_id: 'NFL:0' }),
  ];
  assert.equal(snapshot(stories).rows.length, 2);
  const unresolved = snapshot([story(['Unstructured special bet'])]);
  assert.equal(unresolved.mode, 'admin', 'Unresolved admin picks must not be hidden by a success-only fallback');
  assert.equal(unresolved.rows[0].grade, 'review');
  const unknownTime = snapshot([story(['Commanders ML'], { published_at: null })]);
  assert.equal(unknownTime.rows[0].grade, 'review');
});
test('Ambiguous identities, parlays and admin grading remain explicit, with no silent truncation', () => {
  const data = summary();
  data.boxscore.players[1].statistics[0].athletes.push({ athlete: { id: '4', displayName: 'Other McLaurin' }, stats: ['10', '1', '0'] });
  assert.equal(recap.gradeRecapPick('McLaurin TD', recap.readRecapFinal(data, game)).grade, 'review');
  const source = story(['McLaurin TD\nCommanders +3.5', 'McLaurin TD\nOther Team ML', 'Special pick']);
  source.picks[0].category = 'parlay'; source.picks[1].category = 'parlay'; source.picks[2].result = 'miss';
  const result = snapshot([source]);
  assert.deepEqual(Array.from(result.rows, row => row.grade), ['hit', 'review', 'miss']);
  assert.equal(result.rows[2].source, 'admin');
  assert.match(result.rows[2].detail, /Admin-graded/);
  assert.equal(snapshot([story(Array.from({ length: 12 }, () => 'Commanders +3.5'))]).rows.length, 12);
});
test('Simulation fallback uses only actual saved pregame comparisons and labels selected highlights honestly', () => {
  const saved = comparison(), before = JSON.stringify(saved);
  const result = recap.simulationRecapSnapshot(game, summary(), [], saved,
    [{ teamId: '28', line: 3.5, recordedAt: '2026-11-12T12:00:00Z' }], now);
  assert.equal(result.mode, 'simulation');
  assert.match(result.analysis[0], /selected.*not a betting record/);
  assert.ok(result.rows.some(row => row.title === 'Terry McLaurin TD'));
  assert.ok(result.rows.some(row => /WSH \+3.5/.test(row.title)));
  assert.ok(result.rows.some(row => /Within 10%, not an exact-stat hit/.test(row.detail)));
  assert.ok(!result.rows.some(row => /Nabers/.test(row.title)));
  assert.equal(JSON.stringify(saved), before);
  assert.throws(() => recap.simulationRecapSnapshot(game, summary(), [], undefined, [], now), /No pregame admin picks/);
  for (const invalid of [{ ...saved, forecastAt: kickoff }, { ...saved, eventId: 'other' },
    { ...saved, home: { ...saved.home, actual: 99 } }])
    assert.throws(() => recap.simulationRecapSnapshot(game, summary(), [], invalid, [], now), /does not match/);
});
test('Fallback does not manufacture highlights, postgame lines or a perfect record', () => {
  const saved = comparison(); saved.players = [];
  const result = recap.simulationRecapSnapshot(game, summary(), [], saved,
    [{ teamId: '28', line: 3.5, recordedAt: kickoff }], now);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].grade, 'review');
  assert.match(result.rows[0].title, /No qualifying/);
});
test('Saved spread lines must be pregame, event-matched and selected before knowing which line covered', () => {
  const loader = moduleFrom('../src/services/loadNFLSimulationRecap.ts', name => name.includes('gamewaire') ? engine : {});
  const run = (line, created_at = '2026-11-12T12:00:00Z') => ({
    sport: 'NFL', event_start: kickoff, created_at, payload: { teamLean: { pick: {
      sport: 'NFL', market: 'spreads', side: game.away.name, home: game.home.name, away: game.away.name,
      start: kickoff, line, identifiers: { espnEventId: game.eventId },
      updatedAt: created_at, dataAt: created_at,
    } } },
  });
  const lines = loader.readRecapSpreads([run(3.5), run(-10, '2026-11-12T23:00:00Z')], game);
  assert.equal(lines.length, 1); assert.equal(lines[0].line, -10, 'Latest saved line is chosen without consulting the result');
  const result = recap.simulationRecapSnapshot(game, summary(), [], comparison(), lines, now);
  assert.ok(!result.rows.some(row => /WSH/.test(row.title)), 'An earlier favorable line is not cherry-picked');
  assert.equal(loader.readRecapSpreads([run(3.5, kickoff)], game).length, 0);
  const otherGame = run(3.5); otherGame.payload.teamLean.pick.identifiers.espnEventId = 'other';
  assert.equal(loader.readRecapSpreads([otherGame], game).length, 0);
});
test('Loading recaps fails explicitly on pick-feed errors and never substitutes highlights for existing admin picks', async () => {
  for (const fail of [false, true]) {
    let archives = 0, fetches = 0;
    const calls = [], client = { from(table) {
      const builder = {
        select() { calls.push(table); return this; }, eq() { return this; }, in() { return this; },
        order() { return this; }, range() { return this; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve({
          data: fail ? null : [story(['Commanders +3.5'])], error: fail ? { message: 'offline' } : null,
        }); },
      };
      return builder;
    } };
    const loader = moduleFrom('../src/services/loadNFLSimulationRecap.ts', name => {
      if (name.includes('supabaseClient')) return { supabase: client };
      if (name.includes('theAngle')) return { readAngles: value => value };
      if (name.includes('gamewireBot')) return { loadSimulationAccuracy: () => { archives++; throw new Error('Must not replace picks with highlights'); } };
      if (name.includes('nflSimulationRecap')) return recap;
      if (name.includes('gamewaire')) return engine;
      throw new Error(name);
    }, { fetch: async () => { fetches++; return Response.json(summary()); } });
    const signal = new AbortController().signal;
    if (fail) await assert.rejects(loader.loadNFLSimulationRecap(game, signal), /Could not load Analyst Desk picks: offline/);
    else assert.equal((await loader.loadNFLSimulationRecap(game, signal)).mode, 'admin');
    assert.equal(archives, 0); assert.equal(fetches, 1);
    assert.deepEqual(calls, ['angles'], 'Recap grading performs no record updates, post publication or odds requests');
  }
});

function graphicHarness({ failImage = false, failBlob = false } = {}) {
  const labels = [], panels = [], draws = [], gradient = { addColorStop() {} };
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    toBlob: callback => callback(failBlob ? null : new Blob(['png'], { type: 'image/png' })) };
  const ctx = new Proxy({
    font: '400 20px "DM Sans"', textAlign: 'left',
    createLinearGradient: () => gradient,
    measureText(value) { return { width: String(value).length * Number(this.font.match(/(\d+)px/)[1]) * .5 }; },
    fillText(value, x, y) {
      const width = this.measureText(value).width;
      const left = this.textAlign === 'center' ? x - width / 2 : this.textAlign === 'right' ? x - width : x;
      assert.ok(left >= 0 && left + width <= 768, `${value}: horizontal bounds`);
      assert.ok(y > 0 && y < canvas.height * 768 / 1080, `${value}: vertical bounds`);
      labels.push({ value, y, font: this.font });
    },
    roundRect: (x, y, width, height) => panels.push({ x, y, width, height }),
    drawImage: (...args) => draws.push(args),
    save() { this.savedAlign = this.textAlign; }, restore() { this.textAlign = this.savedAlign ?? 'left'; },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  class Image { set src(value) { if (value) queueMicrotask(() => failImage ? this.onerror() : this.onload()); } }
  const graphic = moduleFrom('../src/services/nflSimulationRecapGraphic.ts', name => {
    if (name.includes('gamewaireResultsGraphic')) return { loadGamewireGraphicAssets: async () => ({}) };
    if (name.includes('TeamAbbrMark')) return { teamMarkColor: value => value ?? '#145cff' };
    throw new Error(name);
  }, { document: { createElement: () => canvas }, Image });
  return { ...graphic, canvas, labels, panels, draws };
}
test('Portrait export matches the reference hierarchy and wraps every row, including long pick text', async () => {
  const h = graphicHarness(), data = snapshot();
  await h.renderSimulationRecapGraphic(data);
  assert.equal(h.canvas.width, 1080); assert.ok(h.canvas.height >= 1350);
  for (const label of ['NFL SIM RECAP', 'BET BREAKDOWN', 'GAMEWIRE ANALYSIS', 'FINAL', 'Washington Commanders', 'New York Giants'])
    assert.ok(h.labels.some(row => row.value === label), label);
  assert.equal(h.draws.length, 1, 'Only the original stadium background is drawn; no player photos or team logos');
  const long = snapshot([story(Array.from({ length: 12 }, (_, i) => `${i}: ${'Original posted pick wording '.repeat(8)}`))]);
  const longer = graphicHarness();
  await longer.renderSimulationRecapGraphic(long);
  assert.ok(longer.canvas.height > h.canvas.height, 'All picks remain readable rather than shrinking or dropping rows');
  const table = longer.panels.find(panel => panel.y === 442);
  const analysis = longer.panels.find(panel => panel.y === 442 + table.height + 16);
  assert.ok(analysis);
});
test('Export errors are explicit, not success-shaped incomplete PNGs', async () => {
  await assert.rejects(graphicHarness({ failImage: true }).renderSimulationRecapGraphic(snapshot()), /artwork could not load/);
  await assert.rejects(graphicHarness({ failBlob: true }).renderSimulationRecapGraphic(snapshot()), /could not export/);
});
test('Only final games expose recap downloads and generation is on-demand and permission-gated', () => {
  const empty = { jsx: createElement, jsxs: createElement };
  for (const allowed of [false, true]) {
    const component = moduleFrom('../src/NFLSimulationRecapDownloads.tsx', name => {
      if (name === 'react') return { useEffect() {}, useRef: value => ({ current: value }) };
      if (name === 'react/jsx-runtime') return empty;
      if (name.includes('useSimulationGraphicAccess')) return { useSimulationGraphicAccess: () => ({ allowed }) };
      if (name.includes('GamewaireResultsDownload')) return { ResultsGraphicDownload: props => createElement('button', null, props.label) };
      if (name.includes('loadNFLSimulationRecap')) return { loadNFLSimulationRecap: () => { throw new Error('Must not load on render'); } };
      if (name.includes('nflSimulationRecapGraphic')) return {};
      throw new Error(name);
    });
    const html = renderToStaticMarkup(createElement(component.default, { games: [game, { ...game, eventId: 'live', status: 'LIVE' }] }));
    assert.equal((html.match(/Download sim recap/g) ?? []).length, allowed ? 1 : 0);
  }
});
