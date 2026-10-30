import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/gamewairePublishedWeek.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const board = (week, events = [{ id: '401' }]) => ({ week: { number: week }, season: { year: 2026, type: 2 }, events });
function fixture(responses, currentWeek = 7) {
  const calls = [];
  const context = vm.createContext({ exports: {}, Error, require(name) {
    if (name === './sportsData') return { getCurrentNFLWeek: () => currentWeek };
    if (name === './sportsDatabase') return { fetchStaticSports: async (url, signal) => {
      calls.push({ url, signal });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { ok: response.status === undefined || response.status === 200, status: response.status ?? 200, json: async () => response };
    } };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(code, context);
  return { load: context.exports.loadPublishedNFLWeek, calls };
}
test('Published NFL defaults to the verified current week and groups games by event identity, not a calendar date', async () => {
  const f = fixture([board(7, [{ id: '401' }, { id: '402' }])]);
  const signal = new AbortController().signal;
  const result = await f.load(null, signal);
  assert.deepEqual({ ...result, eventIds: Array.from(result.eventIds) }, { season: 2026, week: 7, eventIds: ['401', '402'] });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].signal, signal);
});
test('Selecting another week requests its explicit season and regular-season type', async () => {
  const f = fixture([board(7), board(8, [{ id: '403' }])]);
  const result = await f.load(8, new AbortController().signal);
  assert.equal(result.week, 8);
  assert.equal(f.calls[1].url.endsWith('?dates=2026&week=8&seasontype=2'), true);
  assert.deepEqual(Array.from(result.eventIds), ['403']);
});
test('A provider week behind the verified current week is reloaded before showing picks', async () => {
  const f = fixture([board(6), board(7)]);
  assert.equal((await f.load(null, new AbortController().signal)).week, 7);
  assert.equal(f.calls.length, 2);
});
test('Invalid weeks, failed feeds, mismatched weeks and invalid identities surface explicit errors', async () => {
  for (const [responses, week, message] of [
    [[board(7)], 19, /could not be verified/],
    [[{ status: 503 }], 7, /HTTP 503/],
    [[board(7), { status: 502 }], 8, /HTTP 502/],
    [[board(7), board(9)], 8, /did not match/],
    [[board(7, [{ id: '' }])], 7, /invalid game identifier/],
    [[board(7), { ...board(8), season: { year: 2025, type: 2 } }], 8, /did not match/],
  ]) await assert.rejects(fixture(responses).load(week, new AbortController().signal), message);
});
test('NFL published filter has week choices and per-day revision-safe order saves; NBA has a visible native calendar affordance', () => {
  const page = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.match(page, /memberSport === 'NFL' \? <label>NFL regular-season week/);
  assert.match(page, /weekSchedule\.eventIds\.includes\(game\.event_id\)/);
  assert.match(page, /orderDates\.map\(\(orderDate\)/);
  assert.match(page, /<GamewairePickOrder date=\{orderDate\}/);
  assert.match(page, /order\.game_date === orderDate/);
  const css = readFileSync(new URL('../src/gamewaire.css', import.meta.url), 'utf8');
  assert.match(css, /\.gai-published-date::-webkit-calendar-picker-indicator \{ opacity: 1; cursor: pointer/);
});
