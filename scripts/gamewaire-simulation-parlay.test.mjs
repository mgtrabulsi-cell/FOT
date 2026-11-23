import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { simulationOddsEvent, simulationParlay } from '../src/services/simulationParlay.ts';
import { parlayGraphicError, parlayLegLabel } from '../src/services/parlayGraphic.ts';
import { modelVersion } from '../supabase/functions/_shared/gamewaire.ts';
import { soccerName, resolveSoccerMatchup } from '../supabase/functions/_shared/gamewaireSoccer.ts';

const now = Date.parse('2026-11-23T12:00:00Z'), start = new Date(now + 3600000).toISOString();
const game = { eventId: 'espn', date: start, home: { id: 'h', name: 'Los Angeles Lakers', abbr: 'LAL', color: '#552583' },
  away: { id: 'a', name: 'Boston Celtics', abbr: 'BOS', color: '#008348' } };
const candidate = (id, probability, patch = {}) => ({ key: id, eventId: 'odds', sport: 'NBA', start,
  home: 'LA Lakers', away: game.away.name, subject: `Player ${id}`, market: 'player_points', side: 'Over',
  line: 20.5, american: -400, probability, ev: -1, projection: 28, modelVersion,
  updatedAt: new Date(now).toISOString(), dataAt: new Date(now).toISOString(),
  identifiers: { playerId: id, teamId: 'h', espnEventId: 'espn' }, ...patch });
const players = ['1', '2', '3', '4'].map(id => ({ id, stats: { points: { mean: 28 } } }));
const nba = { status: 'ready', eventId: 'espn', kickoff: start, home: { id: 'h', players }, away: { id: 'a', players: [] } };
const report = picks => ({ sport: 'NBA', event_id: 'odds', event_start: start, payload: { picks } });
test('Simulation parlay has exactly three probability-ranked distinct players in the existing same-game graphic schema', () => {
  const picks = [candidate('4', .6, { american: 5000, ev: 4 }), candidate('2', .8), candidate('1', .9),
    candidate('3', .7), candidate('duplicate', .95, { identifiers: { playerId: '1', teamId: 'h', espnEventId: 'espn' } })];
  const result = simulationParlay(report(picks), game, 'NBA', nba, now);
  assert.deepEqual(result.picks.map(row => row.key), ['duplicate', '2', '3']);
  assert.equal(result.graphic.legs.length, 3); assert.equal(result.graphic.title, 'SAME GAME PARLAY');
  assert.equal(result.graphic.odds, ''); assert.equal(result.graphic.images, false);
  assert.equal(parlayGraphicError(result.graphic), '');
  assert.equal(parlayLegLabel(result.graphic.legs[0]), 'Over 20.5 Points');
  assert.ok(result.graphic.legs.every(row => !row.subject.image && !row.subject.teamLogo));
});
test('Stale, invalid, unmatched and simulation-opposed props cannot silently fill missing legs', () => {
  const valid = [candidate('1', .9), candidate('2', .8), candidate('3', .7)];
  for (const patch of [{ american: 99 }, { probability: NaN }, { updatedAt: new Date(now - 600001).toISOString() },
    { line: 30 }, { side: 'Under' }, { identifiers: { playerId: '3', espnEventId: 'wrong' } }]) {
    assert.throws(() => simulationParlay(report([valid[0], valid[1], { ...valid[2], ...patch }]), game, 'NBA', nba, now), /Only 2\/3/);
  }
  assert.throws(() => simulationParlay(report(valid), game, 'NBA', nba, now + 3600001), /pregame/);
  const event = { id: 'odds', sport: 'NBA', home: 'LA Lakers', away: game.away.name, start };
  assert.equal(simulationOddsEvent([event], game, 'NBA').id, 'odds');
  assert.throws(() => simulationOddsEvent([event, event], game, 'NBA'), /unique/);
  assert.throws(() => simulationOddsEvent([{ ...event, start: new Date(now + 7200000).toISOString() }], game, 'NBA'), /unique/);
});
test('NFL parlays must match the displayed saved forecast and selected QB scenario', () => {
  const nfl = { ...nba, version: 'nfl-v1', forecastAt: new Date(now).toISOString(),
    scenarios: [{ id: 'qb', home: {}, away: {} }] };
  const run = { ...report(['1', '2', '3'].map(id => candidate(id, .8, { sport: 'NFL', market: 'player_receptions', line: 4.5 }))),
    sport: 'NFL' };
  assert.throws(() => simulationParlay(run, game, 'NFL', nfl, now), /simulation changed/);
  run.payload.simulationAlignment = { eventId: 'espn', version: 'nfl-v1', forecastAt: nfl.forecastAt, scenarioId: 'qb' };
  assert.equal(simulationParlay(run, game, 'NFL', nfl, now).graphic.legs.length, 3);
  run.payload.simulationAlignment.scenarioId = 'other';
  assert.throws(() => simulationParlay(run, game, 'NFL', nfl, now), /simulation changed/);
});
test('Simulation button requests the matching game, exposes algorithm legs in the shared parlay builder, and respects permissions', async () => {
  const states = [], calls = [];
  let cursor = 0, allowed = true;
  const jsx = (type, props) => ({ type, props });
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) {
      const result = find(child, predicate); if (result) return result;
    }
    return null;
  };
  const futureGame = { ...game, date: new Date(Date.now() + 3600000).toISOString() };
  const forecast = { ...nba, kickoff: futureGame.date };
  const rows = ['1', '2', '3'].map(id => candidate(id, .8, { start: futureGame.date,
    updatedAt: new Date().toISOString(), dataAt: new Date().toISOString() }));
  const context = vm.createContext({ exports: {}, AbortController, AbortSignal, Date, Intl, Error, require(name) {
    if (name === 'react') return { useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = value; }]; }, useRef: () => ({ current: null }), useEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './useSimulationGraphicAccess') return { useSimulationGraphicAccess: () => ({ allowed }) };
    if (name === './ParlayGraphicBuilder') return { default: 'ParlayGraphicBuilder' };
    if (name === './services/simulationParlay') return { simulationOddsEvent, simulationParlay };
    if (name === './services/gamewaire') return { defaultSettings: {}, markets: { NBA: ['player_points'] },
      engineRequest: async body => { calls.push(body); return body.action === 'events'
        ? { events: [{ id: 'odds', sport: 'NBA', home: 'LA Lakers', away: game.away.name, start: futureGame.date }] }
        : { run: { ...report(rows), event_start: futureGame.date } }; } };
    throw new Error(`Unstubbed import ${name}`);
  } });
  const code = ts.transpileModule(readFileSync(new URL('../src/SimulationParlayBuilder.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(code, context);
  const render = () => { cursor = 0; return context.exports.default({ game: futureGame, sport: 'NBA', forecast }); };
  find(render(), node => node.type === 'button').props.onClick();
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  const builder = find(render(), node => node.type === 'ParlayGraphicBuilder');
  assert.ok(builder); assert.equal(builder.props.value.legs.length, 3); assert.equal(builder.props.standalone, true);
  assert.deepEqual(calls.map(row => row.action), ['events', 'analyze']);
  assert.equal(calls[1].eventId, 'odds'); assert.equal(calls[1].fullAnalysis, true);
  allowed = false; assert.equal(render(), null);
});
test('Verified soccer provider aliases match real fixtures without relaxing kickoff or unique identity', async () => {
  const pairs = [['Elche CF', 'Elche'], ['Atalanta BC', 'Atalanta'], ['CA Osasuna', 'Osasuna'],
    ['Real Racing Club de Santander', 'Racing Santander'], ['FSV Mainz 05', 'Mainz'], ['Hamburger SV', 'Hamburg SV'],
    ['Augsburg', 'FC Augsburg'], ['FC Schalke 04', 'Schalke 04'], ['SC Paderborn', 'SC Paderborn 07'],
    ['Elversberg', 'SV Elversberg'], ['Deportivo La Coruña', 'Deportivo'], ['Brighton and Hove Albion', 'Brighton & Hove Albion']];
  for (const [odds, espn] of pairs) {
    assert.equal(soccerName(odds), soccerName(espn));
    const event = { id: 'soccer', date: start, season: { year: 2026 }, competitions: [{
      status: { type: { state: 'pre' } }, competitors: [
        { homeAway: 'home', team: { id: 'h', displayName: espn } }, { homeAway: 'away', team: { id: 'a', displayName: 'Opponent' } }] }] };
    const q = { sport: 'EPL', start, home: odds, away: 'Opponent' };
    const get = async () => Response.json({ events: [event] });
    assert.equal((await resolveSoccerMatchup(q, get)).eventId, 'soccer');
    await assert.rejects(resolveSoccerMatchup({ ...q, start: new Date(Date.parse(start) + 360000).toISOString() }, get), /unambiguously/);
    await assert.rejects(resolveSoccerMatchup(q, async () => Response.json({ events: [event, event] })), /unambiguously/);
  }
});
