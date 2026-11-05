import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { mapEvent, readTeam } from '../src/services/sportsData.ts';

const compile = (file, jsx = false) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
}).outputText;
const away = { id: '1', displayName: 'Atlanta Hawks', abbreviation: 'ATL', color: 'c8102e' };
const home = { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS', color: '007a33' };
function event(id = '401', date = '2025-01-03T00:00:00Z') {
  return { id, date, competitions: [{ status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitors: [{ homeAway: 'away', team: away, score: { value: 100 } }, { homeAway: 'home', team: home, score: { displayValue: '90' } }] }] };
}
const payload = (events = [event()], type = 2) => ({ team: { id: '1' }, season: { year: 2025, type }, events });
function service() {
  const saved = new Map(), requests = [];
  let handler = async () => ({ ok: true, json: async () => payload() });
  const context = vm.createContext({ exports: {}, AbortSignal, Date, Error,
    require(name) {
      if (name === './sportsData.ts') return { mapEvent, readTeam };
      if (name === './renderSnapshots.ts') return {
        readRenderSnapshot: (kind, key) => saved.get(`${kind}:${key}`),
        saveRenderSnapshot: (kind, key, value) => saved.set(`${kind}:${key}`, value),
      };
      if (name === './sportsDatabase.ts') return { fetchStaticSports: (url, signal) => { requests.push(url); return handler(url, signal); } };
      throw new Error(name);
    },
  });
  vm.runInContext(compile('../src/services/teamGameLogs.ts'), context);
  return { api: context.exports, requests, saved, respond: fn => { handler = fn; } };
}
test('directory validates identities and season; season labels preserve NBA ending-year convention', () => {
  const { api } = service();
  const data = { sports: [{ leagues: [{ season: { year: 2025 }, teams: [{ team: home }, { team: away }] }] }] };
  assert.equal(api.parseTeamLogDirectory(data).teams.length, 2);
  assert.equal(api.teamSeasonLabel('NBA', 2025), '2024-25');
  assert.equal(api.teamSeasonLabel('NFL', 2025), '2025');
  assert.throws(() => api.parseTeamLogDirectory({}), /unavailable/);
  data.sports[0].leagues[0].teams[0].team = { id: '2' };
  assert.throws(() => api.parseTeamLogDirectory(data), /identities/);
});
test('completed games normalize score objects, sort, deduplicate and preserve zero scores', () => {
  const { api } = service();
  const zero = event('402', '2025-01-04T00:00:00Z');
  zero.competitions[0].competitors[0].score = 0;
  const entries = api.parseTeamGameLog(payload([event(), zero, event()]), 'NBA', '1', 2025, 2);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].game.eventId, '402');
  assert.equal(entries[0].game.away.score, 0);
  assert.equal(entries[0].game.status, 'FINAL');
  assert.equal(api.teamLogResult(entries[0].game, '1'), 'L');
  assert.equal(api.teamLogResult(entries[1].game, '1'), 'W');
});
test('historical and cached games recover team colors by ID without changing scores or mutating saved games', () => {
  const { api } = service();
  for (const league of ['NBA', 'NFL']) {
    const historical = event();
    for (const row of historical.competitions[0].competitors) {
      row.team = { ...row.team };
      delete row.team.color;
    }
    const original = api.parseTeamGameLog(payload([historical]), league, '1', 2025, 2)[0].game;
    const before = JSON.stringify(original);
    const corrected = api.teamLogGameColors(original, [
      { ...readTeam({ team: away }), color: '#c8102e' }, { ...readTeam({ team: home }), color: '#007a33' },
    ]);
    assert.equal(corrected.away.color, '#c8102e');
    assert.equal(corrected.home.color, '#007a33');
    assert.equal(corrected.away.score, original.away.score);
    assert.equal(corrected.home.score, original.home.score);
    assert.equal(JSON.stringify(original), before);
    assert.equal(api.teamLogGameColors(corrected, []).away.color, '#c8102e');
    assert.equal(api.teamLogGameColors(corrected, [{ id: '1', color: 'invalid' }]).away.color, '#c8102e');
  }
});
test('exclude live, future and canceled games; never invent missing scores or identities', () => {
  const { api } = service();
  for (const change of [
    e => { e.competitions[0].status.type.completed = false; },
    e => { e.competitions[0].status.type.name = 'STATUS_CANCELED'; },
    e => { e.date = '2099-01-01T00:00:00Z'; },
  ]) {
    const e = event(); change(e);
    assert.equal(api.parseTeamGameLog(payload([e]), 'NBA', '1', 2025, 2).length, 0);
  }
  for (const change of [
    e => { delete e.competitions[0].competitors[0].score; },
    e => { e.competitions[0].competitors[0].team = { id: '1' }; },
    e => { e.date = 'invalid'; },
  ]) {
    const e = event(); change(e);
    assert.throws(() => api.parseTeamGameLog(payload([e]), 'NFL', '1', 2025, 2));
  }
  assert.throws(() => api.parseTeamGameLog(payload(), 'NBA', '2', 2025, 2), /different team/);
  assert.throws(() => api.parseTeamGameLog(payload(), 'NBA', '1', 2024, 2), /season/);
  assert.throws(() => api.parseTeamGameLog(payload(), 'NBA', '1', 2025, 3), /phase/);
  assert.equal(api.parseTeamGameLog(payload([]), 'NFL', '1', 2025, 3).length, 0);
});
test('historical feeds use requestedSeason rather than the always-current top-level season', () => {
  const { api } = service();
  const data = { ...payload(), season: { year: 2027, type: 2 }, requestedSeason: { year: 2025, type: 1 } };
  data.events[0].season = { year: 2025 };
  data.events[0].seasonType = { type: 1 };
  assert.equal(api.parseTeamGameLog(data, 'NBA', '1', 2025, 1).length, 1);
  data.events[0].season.year = 2024;
  assert.throws(() => api.parseTeamGameLog(data, 'NBA', '1', 2025, 1), /different season/);
});
test('requests three phases on demand and scopes cache by team, league and season; retry bypasses cache', async () => {
  const s = service();
  s.respond(async url => {
    const parsed = new URL(url), phase = Number(parsed.searchParams.get('seasontype'));
    return { ok: true, json: async () => payload([event(String(400 + phase))], phase) };
  });
  assert.equal(s.requests.length, 0);
  assert.equal((await s.api.fetchTeamGameLog('NBA', '1', 2025)).length, 3);
  assert.equal(s.requests.length, 3);
  await s.api.fetchTeamGameLog('NBA', '1', 2025);
  assert.equal(s.requests.length, 3);
  await s.api.fetchTeamGameLog('NBA', '1', 2025, undefined, true);
  assert.equal(s.requests.length, 6);
  assert.notEqual(s.api.teamLogKey('NBA', '1', 2025), s.api.teamLogKey('NFL', '1', 2025));
  await assert.rejects(s.api.fetchTeamGameLog('NBA', '1', 2024), /season/);
  s.respond(async () => ({ ok: false, status: 503 }));
  await assert.rejects(s.api.fetchTeamGameLog('NBA', '2', 2025), /HTTP 503/);
  const controller = new AbortController(); controller.abort();
  s.respond(async () => ({ ok: true, json: async () => payload([]) }));
  await assert.rejects(s.api.fetchTeamGameLog('NBA', '1', 2025, controller.signal, true), /abort/i);
});

for (const league of ['NBA', 'NFL']) for (const direct of [false, true]) test(`${league} ${direct ? 'direct team link' : 'directory'} opens historical box score and returns to selected season`, async () => {
  const s = service(), team = readTeam({ team: away });
  const entries = s.api.parseTeamGameLog(payload(), league, '1', 2025, 2);
  const slots = [], effects = [], requests = [];
  let cursor = 0, tree;
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({ exports: {}, AbortController, Error,
    require(name) {
      if (name === 'react') return {
        useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
          return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d, n) => d !== slots[i].deps[n]))
          effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
      };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === './useSwipeBack') return { useSwipeBack: () => ({ current: null }) };
      if (name === './OfflineStatus') return { useOnlineStatus: () => true };
      if (name === './services/renderSnapshots') return { readRenderSnapshot: () => null };
      if (name === './services/teamGameLogs') return { ...s.api,
        fetchTeamLogDirectory: async () => ({ teams: [team, readTeam({ team: home })], season: 2025 }),
        fetchTeamGameLog: async (...args) => { requests.push(args); return entries; },
      };
      return { default: name, ChevronLeft: 'left', ChevronRight: 'right' };
    },
  });
  vm.runInContext(compile('../src/TeamGameLogs.tsx', true), context);
  const render = async () => {
    cursor = 0; tree = context.exports.default({ league, ...(direct ? { initialTeam: team, initialSeason: 2024 } : {}), favorites: [], onToggleFavorite() {}, onOpenPlayer() {} });
    effects.splice(0).forEach(fn => fn()); await Promise.resolve();
  };
  const nodes = () => {
    const found = [];
    const visit = n => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return;
      found.push(n); visit(n.props?.children); };
    visit(tree); return found;
  };
  await render(); await render();
  if (direct) {
    assert.equal(requests.at(-1)[1], team.id);
    assert.equal(requests.at(-1)[2], 2024);
  } else {
    assert.equal(requests.length, 0, 'No schedules loaded before team selection');
    nodes().find(n => n.type === 'button').props.onClick();
  }
  await render(); await render();
  nodes().find(n => n.type === 'select').props.onChange({ target: { value: '2024' } });
  await render(); await render();
  assert.equal(requests.at(-1)[2], 2024);
  nodes().find(n => n.props?.['data-team-log-game']).props.onClick();
  await render();
  const box = nodes().find(n => n.type === (league === 'NBA' ? './NBAExperience' : './TheWire'));
  assert.equal(box.props.openGameId, entries[0].game.id);
  assert.equal(box.props.games[0].away.color, team.color);
  assert.equal(box.props.games[0].home.color, `#${home.color}`);
  assert.equal(box.props.backLabel, 'Team game log');
  assert.equal(typeof box.props.onOpenTeamLog, 'function');
  box.props.onBackToGames(); await render();
  assert.equal(nodes().find(n => n.type === 'select').props.value, 2024);
  nodes().find(n => n.props?.['data-team-log-game']).props.onClick(); await render();
  nodes().find(n => n.type === (league === 'NBA' ? './NBAExperience' : './TheWire')).props.onOpenTeamLog(readTeam({ team: home }), 2025);
  await render(); await render();
  assert.equal(requests.at(-1)[1], '2');
  assert.equal(nodes().find(n => n.type === 'select').props.value, 2025);
  nodes().find(n => n.props?.className === 'wire-back-button').props.onClick(); await render();
  assert.ok(nodes().some(n => n.props?.className === 'team-log-directory'));
});
