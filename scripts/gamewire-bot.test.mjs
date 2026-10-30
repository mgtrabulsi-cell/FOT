import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import * as engine from '../supabase/functions/_shared/gamewaire.ts';
import * as sources from '../supabase/functions/_shared/gamewaireSources.ts';
import * as bot from '../supabase/functions/_shared/gamewireBot.ts';

const now = Date.parse('2026-10-29T18:00:00Z');
const player = { id: '123', name: 'Test Runner', position: 'RB', teamId: '23', team: 'Pittsburgh Steelers', teamAbbr: 'PIT' };
const athlete = { id: player.id, displayName: player.name, position: { abbreviation: 'RB' }, status: { type: 'active', name: 'Active' }, injuries: [] };
const roster = { athletes: [{ items: [athlete] }] };
const board = { season: { year: 2026, type: 2 }, week: { number: 8 }, events: [{
  id: '401234567', date: '2026-11-01T18:00:00Z', competitions: [{ status: { type: { state: 'pre' } }, competitors: [
    { homeAway: 'home', team: { id: '23', displayName: 'Pittsburgh Steelers' } },
    { homeAway: 'away', team: { id: '5', displayName: 'Cleveland Browns' } },
  ] }],
}] };
const names = ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns', 'fumblesLost'];
const logs = {
  names, events: Object.fromEntries([1, 2, 3].map((id) => [String(id), { gameDate: `2026-10-${String(26 - id * 7).padStart(2, '0')}T18:00:00Z` }])),
  seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: [1, 2, 3].map((id) => ({ eventId: String(id), stats: ['15', '75', '1', '3', '4', '30', '0', '0'] })) }] }],
};
const report = (options = {}) => bot.buildBotReport(options.player ?? player, options.roster === undefined ? roster : options.roster, options.logs === undefined ? logs : options.logs,
  options.board ?? board, options.format ?? 'ppr', options.now ?? now);
const graphic = { id: 'published-graphic', updated_at: new Date(now).toISOString(),
  published_content: { kind: 'sit', position: 'RB', slots: [{ player, reason: 'His recent role is too limited for this matchup.' }] } };
const ranking = { player_id: player.id, player_name: player.name, team_id: player.teamId, position: 'RB', rank: 29, scoring_format: 'ppr', published_at: new Date(now).toISOString() };

test('Published weekly graphics and exact scoring-format rankings inform the verdict; no draft guidance leaks', () => {
  const result = bot.applyBotEditorial(report(), [graphic], [ranking]);
  assert.equal(result.indication, 'Must Sit');
  assert.equal(result.editorial.ranking.rank, 29);
  assert.match(result.summary, /published graphic.*Must Sit/);
  assert.match(result.summary, /RB29/);
  assert.equal(result.editorial.graphics[0].reason, graphic.published_content.slots[0].reason);
  assert.equal(bot.applyBotEditorial(report(), [{ ...graphic, published_content: { ...graphic.published_content, kind: 'start' } }], []).indication, 'Must Start');
  assert.equal(bot.applyBotEditorial(report(), [], [{ ...ranking, rank: 1 }]).indication, 'Must Start');
  const draft = { ...graphic, content: graphic.published_content, published_content: null };
  assert.equal(bot.applyBotEditorial(report(), [draft], []).editorial.graphics.length, 0);
  const wrongPlayer = structuredClone(graphic); wrongPlayer.published_content.slots[0].player = { ...player, id: '999' };
  assert.equal(bot.applyBotEditorial(report(), [wrongPlayer], []).editorial.graphics.length, 0);
  assert.equal(bot.applyBotEditorial(report({ format: 'standard' }), [], [ranking]).editorial.ranking, null);
});
test('Top-30 ranking alone never means automatic starter; injury and game locks override editorial START', () => {
  const result = bot.applyBotEditorial(report(), [], [ranking]);
  assert.equal(result.indication, 'Flex');
  assert.match(result.summary, /different directions/);
  const start = structuredClone(graphic); start.published_content.kind = 'start';
  const injured = report({ roster: { athletes: [{ ...athlete, injuries: [{ status: 'Out' }] }] } });
  assert.equal(bot.applyBotEditorial(injured, [start], [{ ...ranking, rank: 1 }]).indication, 'Monitor');
  const locked = report({ now: Date.parse(board.events[0].date) });
  assert.equal(bot.applyBotEditorial(locked, [start], []).indication, 'Game locked');
  assert.equal(bot.applyBotEditorial(report(), [start, graphic], []).indication, 'Monitor');
});

test('Current week and roster parsing reject unverified IDs/week metadata and keep QB/RB/WR/TE only', () => {
  assert.deepEqual(bot.readBotWeek(board), { season: 2026, seasonType: 2, week: 8 });
  assert.throws(() => bot.readBotWeek({ season: { year: 2026, type: 2 } }), /valid current NFL/);
  assert.deepEqual(bot.readBotRoster(roster, { id: '23', name: player.team, abbr: 'PIT' }), [player]);
  assert.equal(bot.readBotRoster({ athletes: [athlete, { ...athlete, id: '44', position: { abbreviation: 'K' } }] }, { id: '23', name: player.team, abbr: 'PIT' }).length, 1);
  assert.throws(() => bot.readBotRoster({}, { id: '23', name: player.team, abbr: 'PIT' }), /invalid roster/);
});
test('PPR/half/standard use recorded scoring, with no fabricated missing stats', () => {
  assert.equal(report().fantasyAverage, 19.5);
  assert.equal(report({ format: 'half' }).fantasyAverage, 18);
  assert.equal(report({ format: 'standard' }).fantasyAverage, 16.5);
  const missing = structuredClone(logs); missing.seasonTypes[0].categories[0].events[0].stats[7] = '-';
  assert.equal(report({ logs: missing }).fantasyAverage, null);
  assert.equal(report().production[0].average, 75);
});
test('Workload threshold boundaries are exact, scoring-aware and labeled as considerations, not projections', () => {
  assert.equal(report().indication, 'Start');
  for (const [carries, catches, expected] of [[12, 3, 'Start'], [5, 3, 'Flex'], [4, 3, 'Sit']]) {
    const data = structuredClone(logs);
    for (const row of data.seasonTypes[0].categories[0].events) { row.stats[0] = String(carries); row.stats[3] = String(catches); }
    assert.equal(report({ logs: data }).indication, expected);
  }
  const receiver = { ...player, position: 'WR' }, receiverRoster = { athletes: [{ ...athlete, position: { abbreviation: 'WR' } }] };
  const data = structuredClone(logs);
  for (const row of data.seasonTypes[0].categories[0].events) row.stats[4] = '7';
  assert.equal(report({ player: receiver, roster: receiverRoster, logs: data }).indication, 'Start');
  assert.equal(report({ player: receiver, roster: receiverRoster, logs: data, format: 'standard' }).indication, 'Flex');
  assert.match(report().warnings.join(' '), /not conversational AI or a fantasy projection/);
});
test('Injuries, incomplete workloads, short samples and stale appearances never force a Start', () => {
  const injured = { athletes: [{ ...athlete, injuries: [{ status: 'Out' }] }] };
  assert.equal(report({ roster: injured }).indication, 'Monitor');
  assert.match(report({ roster: injured }).summary, /Out/);
  const incomplete = structuredClone(logs); incomplete.seasonTypes[0].categories[0].events[0].stats[0] = '-';
  assert.equal(report({ logs: incomplete }).indication, 'Monitor');
  const short = structuredClone(logs); short.seasonTypes[0].categories[0].events.pop();
  assert.equal(report({ logs: short }).indication, 'Monitor');
  const stale = structuredClone(logs); Object.values(stale.events).forEach((row) => row.gameDate = '2026-09-01T18:00:00Z');
  assert.equal(report({ logs: stale }).indication, 'Monitor');
  assert.equal(report({ logs: { names: [], events: {}, seasonTypes: [] } }).indication, 'Monitor');
  assert.throws(() => report({ logs: {} }), /logs are unavailable/);
});
test('Current-season regular games only; future games, duplicates and preseason are excluded', () => {
  const data = structuredClone(logs);
  data.events.future = { gameDate: '2026-11-09T18:00:00Z' };
  data.seasonTypes[0].categories[0].events.push({ eventId: 'future', stats: names.map(() => '999') });
  data.seasonTypes.push({ displayName: '2026 Preseason', categories: [{ events: [{ eventId: '1', stats: names.map(() => '999') }] }] });
  assert.equal(report({ logs: data }).workload[0].average, 15);
  data.seasonTypes[0].displayName = '2025 Regular Season';
  assert.throws(() => report({ logs: data }), /requested NFL season/);
});
test('Missing weekly games, kickoff lock, postseason and transferred player identities are explicit', () => {
  assert.equal(report({ board: { ...board, events: [] } }).indication, 'No upcoming game');
  assert.equal(report({ now: Date.parse(board.events[0].date) }).indication, 'Game locked');
  const final = structuredClone(board); final.events[0].competitions[0].status.type.state = 'post';
  assert.equal(report({ board: final }).indication, 'Game locked');
  assert.equal(report({ board: { ...board, season: { year: 2026, type: 3 } } }).indication, 'Monitor');
  assert.throws(() => report({ roster: { athletes: [] } }), /current team roster/);
  assert.throws(() => bot.botMatchup({ ...board, events: [board.events[0], board.events[0]] }, player), /More than one game/);
});

const endpointCode = ts.transpileModule(readFileSync(new URL('../supabase/functions/gamewire-bot/index.ts', import.meta.url), 'utf8')
  .replace(/if \(import\.meta\.main\) Deno\.serve[^;]+;/, ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint({ allowed = true, user = true, claim = true, cacheFailure = false, pubFailure = false, cold = false, badLogs = false, pubs = [], graphics = [], rankings = [], upstreamFail = false, primaryWeekFail = false, primaryRosterFail = false } = {}) {
  const calls = [], writes = [], rpcs = [], queries = [], cache = new Map(), expires = new Date(now + 3600000).toISOString();
  if (!cold) cache.set('nfl:directory:v2:2026', { payload: { season: 2026, week: 8, seasonType: 2, players: [player], positions: { [player.id]: 'RB' }, warnings: [], checkedAt: new Date(now).toISOString() }, expires_at: expires });
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: 'owner' } : null }, error: null }) },
    rpc: async (name) => { rpcs.push(name); return { data: name === 'gamewaire_can_admin' ? allowed : claim, error: null }; },
    from(table) {
      const filters = {}; queries.push({ table, filters });
      const builder = {
        select: () => builder, eq: (key, value) => { filters[key] = value; return builder; },
        gt: () => builder, gte: () => builder, lte: () => builder, limit: () => builder, not: () => builder,
        maybeSingle: async () => ({ data: cache.get(filters.cache_key) ?? null, error: cacheFailure ? { message: 'DB failed' } : null }),
        upsert: async (value) => { writes.push(table); cache.set(value.cache_key, value); return { error: null }; },
        then: (resolve) => Promise.resolve({ data: table === 'fantasy_graphics' ? graphics : table === 'gamewire_fantasy_rankings' ? rankings : pubs, error: pubFailure ? { message: 'DB failed' } : null }).then(resolve),
      }; return builder;
    },
  };
  const env = { get: (name) => {
    assert.ok(!/ODDS|OPENAI/.test(name), 'Preview must not require paid API credentials');
    return { SUPABASE_URL: 'https://test', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'service' }[name];
  } };
  const fetcher = async (url) => {
    const href = String(url); calls.push(href);
    assert.ok(new URL(href).hostname.endsWith('.espn.com'));
    if (upstreamFail) return new Response('', { status: 503 });
    if (primaryWeekFail && href.includes('site.api.espn.com') && href.includes('/scoreboard')) return new Response('', { status: 403 });
    if (primaryRosterFail && href.includes('site.api.espn.com') && href.includes('/roster')) return new Response('', { status: 403 });
    if (href.includes('/scoreboard')) return Response.json(board);
    if (href.includes('/gamelog')) return badLogs ? new Response('', { status: 503 }) : Response.json(logs);
    if (href.includes('/standings')) return Response.json({ season: { year: 2026 }, children: [{
      standings: { entries: Array.from({ length: 32 }, (_, id) => ({ team: { id: String(id + 1), displayName: id === 4 ? 'Cleveland Browns' : `Team ${id}` },
        stats: [{ name: 'wins', value: 4 }, { name: 'losses', value: 3 }, { name: 'ties', value: 0 }, { name: 'pointsAgainst', value: 140 + id }, { name: 'pointsFor', value: 154 }] })) },
    }] });
    if (href.includes('/teams?')) return Response.json({ sports: [{ leagues: [{ teams: Array.from({ length: 32 }, (_, id) => ({ team: { id: String(id + 1), displayName: `Team ${id}`, abbreviation: `T${id}` } })) }] }] });
    if (href.includes('/roster')) return Response.json(roster);
    throw new Error(`Unexpected upstream: ${href}`);
  };
  const context = vm.createContext({ exports: {}, Error, Response, Request, URL, AbortSignal, console: { error() {} },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    require(name) {
      if (name.startsWith('npm:')) return { createClient: () => client };
      if (name.includes('gamewireBotProjections')) return { collectBotProjections: async () => [] };
      if (name.includes('gamewireBot')) return bot;
      if (name.includes('gamewaireSources')) return sources;
      return engine;
    },
  });
  vm.runInContext(endpointCode, context);
  return { calls, writes, rpcs, queries, cache,
    run: (body = { action: 'breakdown', playerId: '123', format: 'ppr' }, auth = true) => context.exports.handleGamewireBot(new Request('https://test/bot', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body),
    }), env, fetcher) };
}
test('Bot rejects guests, expired sessions and non-designated members/admins before cache/upstream access', async () => {
  for (const [options, auth, status] of [[{}, false, 401], [{ user: false }, true, 401], [{ allowed: false }, true, 403]]) {
    const api = endpoint(options), result = await api.run(undefined, auth);
    assert.equal(result.status, status); assert.equal(api.calls.length, 0); assert.equal(api.writes.length, 0);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
});
test('Input validation happens before fetches and usage claims', async () => {
  for (const body of [{ action: 'chat' }, { action: 'breakdown', playerId: '../private', format: 'ppr' }, { action: 'breakdown', playerId: '123', format: 'superflex' }]) {
    const api = endpoint(), result = await api.run(body);
    assert.equal(result.status, 400); assert.equal(api.calls.length, 0); assert.ok(!api.rpcs.includes('gamewire_bot_claim'));
  }
});
test('Verified owner breakdown uses only public ESPN feeds, reuses snapshots and returns no private metrics', async () => {
  const api = endpoint(), response = await api.run(), data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.aiEnabled, false); assert.equal(data.mode, 'verified-preview');
  assert.equal(data.report.indication, 'Start');
  assert.match(data.report.matchupText, /rank 5 of 32/);
  assert.match(data.report.propNote, /No matching published/);
  assert.equal(data.report.props.length, 0);
  assert.ok(api.calls.every((url) => url.includes('.espn.com/')));
  const count = api.calls.length;
  const cached = await (await api.run()).json();
  assert.equal(cached.cached, true); assert.equal(api.calls.length, count);
  assert.deepEqual(api.writes.filter((table) => table !== 'gamewire_bot_cache'), []);
  assert.doesNotMatch(JSON.stringify(data), /conservativeEV|probability|service-role|Stretch/);
});
test('Upstream, cache, quota and publication failures are explicit, not successful-looking empty reports', async () => {
  for (const options of [{ cacheFailure: true }, { pubFailure: true }, { upstreamFail: true }]) {
    const response = await endpoint(options).run();
    assert.equal(response.status, 502); assert.ok((await response.json()).error);
  }
  const blocked = endpoint({ claim: false });
  const response = await blocked.run();
  assert.equal(response.status, 429); assert.equal(blocked.calls.length, 0);
});
test('Blocked ESPN logs are an explicit partial response, not invented workload or a discarded published graphic', async () => {
  const api = endpoint({ badLogs: true, graphics: [graphic] });
  const response = await api.run(), data = await response.json();
  assert.equal(response.status, 206); assert.equal(data.partial, true);
  assert.equal(data.report.indication, 'Must Sit');
  assert.equal(data.report.workload.length, 0); assert.equal(data.report.fantasyAverage, null);
  assert.match(data.report.dataIssues.join(' '), /503/);
  assert.equal(data.report.editorial.graphics.length, 1);
  assert.ok([...api.cache.entries()].filter(([key]) => key.includes('breakdown')).every(([, value]) => Date.parse(value.expires_at) - now === 30000));
  assert.equal(bot.applyBotEditorial(report({ roster: null }), [{ ...graphic, published_content: { ...graphic.published_content, kind: 'start' } }], []).indication, 'Monitor');
});
test('Published props require exact current ESPN identities and enforce the -200 floor without exposing candidates', async () => {
  const base = { sport: 'NFL', market: 'player_rush_yds', subject: player.name, side: 'Over', line: 60.5, american: -114,
    book: 'Saved Book', updatedAt: new Date(now - 3600000).toISOString(), samples: [{ date: '2026-10-19', value: 75, season: 2026 }],
    seasonAverage: 75, home: player.team, away: 'Cleveland Browns', identifiers: { playerId: player.id, espnEventId: '401234567' } };
  const pubs = [{ picks: [base, { ...base, line: 61.5, american: -201 }, { ...base, identifiers: { playerId: '999', espnEventId: '401234567' } },
    { ...base, identifiers: { playerId: player.id, espnEventId: 'old-game' } }, { ...base, subject: 'Another Runner' }] }];
  const response = await endpoint({ pubs }).run(), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.report.props.length, 1);
  assert.equal(data.report.props[0].selection, 'Test Runner Over 60.5 rushing yards');
  assert.equal(data.report.props[0].american, -114);
  assert.match(data.report.propNote, /not current sportsbook prices/);
  assert.deepEqual(Object.keys(data.report.props[0]).sort(), ['american', 'book', 'breakdown', 'savedAt', 'selection']);
});
test('Editorial reads are scoped to this season/week, player and selected scoring, even with cached workloads', async () => {
  const api = endpoint({ graphics: [graphic], rankings: [ranking] });
  const response = await api.run(), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.report.indication, 'Must Sit');
  const source = api.queries.find((query) => query.table === 'fantasy_graphics');
  assert.deepEqual(source.filters, { season: 2026, week: 8 });
  assert.deepEqual(api.queries.find((query) => query.table === 'gamewire_fantasy_rankings').filters,
    { season: 2026, week: 8, scoring_format: 'ppr', position: 'RB', player_id: player.id });
  const reads = api.queries.length; await api.run();
  assert.ok(api.queries.slice(reads).some((query) => query.table === 'fantasy_graphics'), 'Editorial changes must not wait for workload cache expiry');
});
test('Cold player search loads the real NFL roster directory, with no odds requests or publishing', async () => {
  const api = endpoint({ cold: true }), response = await api.run({ action: 'directory' }), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.players.length, 1);
  assert.equal(api.calls.filter((href) => href.includes('/roster')).length, 32);
  assert.equal(data.week, 8); assert.equal(data.aiEnabled, false);
  assert.ok(api.writes.every((table) => table === 'gamewire_bot_cache'));
});
test('A primary week-feed failure can use ESPN’s equivalent public host, with explicit provenance', async () => {
  const api = endpoint({ primaryWeekFail: true });
  const response = await api.run({ action: 'directory' }), data = await response.json();
  assert.equal(response.status, 200);
  assert.match(data.warnings.join(' '), /equivalent public feed/);
  assert.ok(api.calls.some((url) => url.startsWith('https://site.web.api.espn.com/')));
});
test('Player rosters can use the equivalent ESPN public host without losing all searchable players or flooding warnings', async () => {
  const api = endpoint({ cold: true, primaryRosterFail: true });
  const response = await api.run({ action: 'directory' }), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.players.length, 1);
  assert.equal(data.warnings.length, 1);
  assert.match(data.warnings[0], /equivalent public feed/);
  assert.equal(api.calls.filter((url) => url.includes('/roster') && url.includes('site.web.api.espn.com')).length, 32);
});
test('Bot client topics are constrained and UI remains owner-gated with accessible controls', () => {
  const service = readFileSync(new URL('../src/services/gamewireBot.ts', import.meta.url), 'utf8');
  const topicCode = ts.transpileModule(service, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ exports: {}, require: () => ({ supabase: null }) }); vm.runInContext(topicCode, context);
  for (const [question, expected] of [['Show props', 'props'], ['His targets and usage?', 'overview'], ['Start him?', 'start-sit'], ['The defense matchup?', 'matchup'], ['Tell me a joke', null]]) assert.equal(context.exports.botTopic(question), expected);
  assert.equal(context.exports.readBotReport(report()).player.id, player.id);
  for (const invalid of [{}, { ...report(), editorial: undefined }, { ...report(), props: [{}] }, { ...report(), workload: [{}] }])
    assert.throws(() => context.exports.readBotReport(invalid), /incomplete player breakdown/);
  const page = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  assert.match(page, /status\?\.canAnalyze && <GamewireBot/);
  const ui = readFileSync(new URL('../src/GamewireBot.tsx', import.meta.url), 'utf8');
  assert.match(ui, /aria-expanded=/); assert.match(ui, /Conversational AI not enabled/); assert.match(ui, /role="alert"/);
  assert.match(ui, /controller\.current\?\.abort/);
  assert.match(ui, /Questions stay in this tab/);
});

function botWelcomeHarness({ directoryError = false, players = [player], loadReport = (id, format) => ({ ...report({ format }), player: players.find((row) => row.id === id) }) } = {}) {
  const state = [], refs = [];
  const reportRequests = [], timers = new Map();
  let stateIndex = 0, refIndex = 0, directoryCalls = 0, reportCalls = 0;
  const code = ts.transpileModule(readFileSync(new URL('../src/GamewireBot.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = vm.createContext({ exports: {}, AbortController, Date, Error, window: {
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.set(timer, callback); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
  }, require: (name) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'react') return {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
      },
      useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
      useEffect() {},
    };
    if (name === './services/gamewireBot') return {
      async loadBotDirectory() { directoryCalls++; if (directoryError) throw new Error('Roster feed unavailable'); return { players, warnings: [] }; },
      async loadBotReport(id, format, signal) { reportCalls++; reportRequests.push({ id, format }); return loadReport(id, format, signal); },
    };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, icon) => icon });
    return {};
  } });
  vm.runInContext(code, context);
  const render = () => { stateIndex = 0; refIndex = 0; return context.exports.default(); };
  const find = (root, predicate) => {
    if (!root || typeof root !== 'object') return undefined;
    if (predicate(root)) return root;
    const children = Array.isArray(root) ? root : root.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = find(child, predicate); if (found) return found;
    }
  };
  const byClass = (tree, name) => find(tree, (node) => node.props?.className === name);
  const search = async (value) => {
    let tree = render();
    find(tree, (node) => node.props?.id === 'gwb-player-search').props.onChange({ target: { value } });
    await new Promise(setImmediate); tree = render();
    byClass(tree, 'gwb-hero-search').props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
    return render();
  };
  const expire = () => { for (const [timer, callback] of timers) { clearTimeout(timer); timers.delete(timer); callback(); } };
  return { render, find, byClass, search, reportRequests, expire, counts: () => ({ directoryCalls, reportCalls }) };
}
test('Welcome search opens the preview, analyzes a unique match and keeps the conversation when closed', async () => {
  const ui = botWelcomeHarness();
  let tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-toggle').props['aria-expanded'], false);
  ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.onFocus();
  await new Promise(setImmediate);
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-toggle').props['aria-expanded'], true);
  ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.onChange({ target: { value: 'Test Runner' } });
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-search-results').props.children[0].length, 1);
  ui.byClass(tree, 'gwb-hero-search').props.onSubmit({ preventDefault() {} });
  await new Promise(setImmediate);
  tree = ui.render();
  const conversation = ui.byClass(tree, 'gwb-conversation').props.children;
  assert.equal(conversation.length, 1);
  assert.match(conversation[0].props.children[0].props.children, /Test Runner/);
  ui.byClass(tree, 'gwb-toggle').props.onClick();
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-panel'), undefined);
  ui.byClass(tree, 'gwb-toggle').props.onClick();
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children[0].key, conversation[0].key);
  assert.deepEqual(ui.counts(), { directoryCalls: 1, reportCalls: 1 });
});
test('Welcome search survives close/reopen and displays roster feed errors with a retry', async () => {
  const ui = botWelcomeHarness({ directoryError: true });
  let tree = ui.render();
  ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.onChange({ target: { value: 'Runner' } });
  await new Promise(setImmediate);
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-error').props.role, 'alert');
  assert.equal(ui.byClass(tree, 'gwb-error').props.children[0].props.children, 'Roster feed unavailable');
  assert.equal(ui.byClass(tree, 'gwb-error').props.children[1].props.children, 'Retry');
  ui.byClass(tree, 'gwb-toggle').props.onClick();
  tree = ui.render();
  assert.equal(ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.value, 'Runner');
  ui.byClass(tree, 'gwb-toggle').props.onClick();
  await new Promise(setImmediate);
  tree = ui.render();
  assert.equal(ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.value, 'Runner');
  assert.equal(ui.counts().directoryCalls, 2);
});
test('GamewAIre density is scoped to desktop and the blue preview keeps accessible phone input sizes', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const botCss = readFileSync(new URL('../src/gamewire-bot.css', import.meta.url), 'utf8');
  assert.match(app, /view === 'Gamewaire' \? 'page-wrap gamewaire-page'/);
  assert.match(css, /@media \(min-width: 1100px\) \{\s*\.page-wrap\.gamewaire-page \{ zoom: \.9;/);
  assert.match(botCss, /\.gwb-wordmark \{[^}]*var\(--display/);
  assert.match(botCss, /\.gwb-hero-footer \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(botCss, /\.gwb-hero-search \{[^}]*width: 100%;/);
  assert.match(botCss, /\.gwb-prop-lab \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const phoneCss = botCss.slice(botCss.indexOf('@media (max-width: 600px)'));
  assert.match(phoneCss, /\.gwb\.gwb \.gwb-hero-search input \{ font-size: 16px;/);
  assert.doesNotMatch(phoneCss, /zoom:/);
  assert.match(phoneCss, /\.gwb-comparison \{ grid-template-columns: 1fr;/);
});
const secondPlayer = { ...player, id: '456', name: 'Other Receiver', position: 'WR' };
const thirdPlayer = { ...player, id: '789', name: 'Third Tight End', position: 'TE' };
test('Clear search removes typed text but preserves the selected player outlook', async () => {
  const ui = botWelcomeHarness();
  let tree = await ui.search(player.name);
  ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.onChange({ target: { value: 'New search' } });
  tree = ui.render();
  const clear = ui.find(tree, (node) => node.props?.['aria-label'] === 'Clear player search');
  assert.equal(clear.props.type, 'button');
  clear.props.onClick(); tree = ui.render();
  assert.equal(ui.find(tree, (node) => node.props?.id === 'gwb-player-search').props.value, '');
  assert.equal(ui.byClass(tree, 'gwb-search-results'), undefined);
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children.length, 1);
});
test('Clear player removes their outlook, question and follow-up history without fetching again', async () => {
  const ui = botWelcomeHarness();
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-followups').props.children[0][0].props.onClick(); tree = ui.render();
  ui.find(tree, (node) => node.props?.id === 'gwb-question').props.onChange({ target: { value: 'His props?' } }); tree = ui.render();
  ui.find(tree, (node) => node.props?.['aria-label'] === `Clear ${player.name}`).props.onClick(); tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children.length, 0);
  assert.equal(ui.byClass(tree, 'gwb-selected-players'), undefined);
  assert.equal(ui.byClass(tree, 'gwb-followups'), undefined);
  ui.find(tree, (node) => node.type === 'select').props.onChange({ target: { value: 'half' } });
  assert.equal(ui.counts().reportCalls, 1, 'Cleared players cannot be refreshed by a scoring change');
  tree = await ui.search(player.name);
  assert.equal(ui.find(tree, (node) => node.props?.id === 'gwb-question').props.value, '');
});
test('Clearing either comparison player preserves the other and allows refilling the cleared slot', async () => {
  const ui = botWelcomeHarness({ players: [player, secondPlayer] });
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-compare-button').props.onClick();
  tree = await ui.search(secondPlayer.name);
  ui.find(tree, (node) => node.props?.['aria-label'] === `Clear ${player.name}`).props.onClick(); tree = ui.render();
  let columns = ui.byClass(tree, 'gwb-comparison').props.children;
  assert.equal(columns[0].props.children.props.className, 'gwb-compare-empty');
  assert.equal(columns[1].props.children.props.report.player.id, secondPlayer.id);
  assert.equal(ui.byClass(tree, 'gwb-compare-slots').props.children[0].props['aria-pressed'], true);
  tree = await ui.search(player.name);
  ui.find(tree, (node) => node.props?.['aria-label'] === `Clear ${secondPlayer.name}`).props.onClick(); tree = ui.render();
  columns = ui.byClass(tree, 'gwb-comparison').props.children;
  assert.equal(columns[0].props.children.props.report.player.id, player.id);
  assert.equal(columns[1].props.children.props.className, 'gwb-compare-empty');
  ui.find(tree, (node) => node.type === 'select').props.onChange({ target: { value: 'half' } });
  await new Promise(setImmediate); tree = ui.render();
  assert.equal(ui.reportRequests.at(-1).id, player.id);
  assert.equal(ui.byClass(tree, 'gwb-comparison').props.children[1].props.children.props.className, 'gwb-compare-empty');
});
test('Searching a new player replaces the first player and clears their follow-up history', async () => {
  const ui = botWelcomeHarness({ players: [player, secondPlayer] });
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-followups').props.children[0][0].props.onClick();
  tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children.length, 2);
  tree = await ui.search(secondPlayer.name);
  const messages = ui.byClass(tree, 'gwb-conversation').props.children;
  assert.equal(messages.length, 1);
  assert.match(messages[0].props.children[0].props.children, /Other Receiver/);
  assert.doesNotMatch(messages[0].props.children[0].props.children, /Test Runner/);
});
test('Compare supports two distinct players, slot replacement, shared scoring and returning to single-player mode', async () => {
  const ui = botWelcomeHarness({ players: [player, secondPlayer, thirdPlayer] });
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-compare-button').props.onClick(); tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-compare-button').props['aria-pressed'], true);
  assert.equal(ui.byClass(tree, 'gwb-compare-slots').props.children[1].props['aria-pressed'], true);
  tree = await ui.search(player.name);
  assert.equal(ui.byClass(tree, 'gwb-search-results').props.children[0].length, 0, 'Primary cannot also be selected as player 2');
  tree = await ui.search(secondPlayer.name);
  const outlines = () => ui.byClass(tree, 'gwb-comparison').props.children.map((column) => column.props.children);
  assert.equal(outlines()[0].props.report.player.id, player.id);
  assert.equal(outlines()[1].props.report.player.id, secondPlayer.id);
  assert.equal(ui.byClass(tree, 'gwb-conversation'), undefined);
  tree = await ui.search(thirdPlayer.name);
  assert.equal(outlines()[0].props.report.player.id, player.id);
  assert.equal(outlines()[1].props.report.player.id, thirdPlayer.id);
  ui.find(tree, (node) => node.type === 'select').props.onChange({ target: { value: 'half' } });
  await new Promise(setImmediate); tree = ui.render();
  assert.equal(outlines()[0].props.report.format, 'half');
  assert.equal(outlines()[1].props.report.format, 'half');
  assert.deepEqual(ui.reportRequests.slice(-2), [{ id: player.id, format: 'half' }, { id: thirdPlayer.id, format: 'half' }]);
  ui.byClass(tree, 'gwb-compare-button').props.onClick(); tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-comparison'), undefined);
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children.length, 1);
  tree = await ui.search(secondPlayer.name);
  assert.match(ui.byClass(tree, 'gwb-conversation').props.children[0].props.children[0].props.children, /Other Receiver/);
});
test('Comparison preserves a successful first player when the second fails and retries the failed request', async () => {
  let failing = true;
  const ui = botWelcomeHarness({ players: [player, secondPlayer], loadReport(id, format) {
    if (id === secondPlayer.id && failing) throw new Error('Player logs unavailable');
    return { ...report({ format }), player: id === player.id ? player : secondPlayer };
  } });
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-compare-button').props.onClick();
  tree = await ui.search(secondPlayer.name);
  assert.match(ui.byClass(tree, 'gwb-error').props.children[0].props.children, /Other Receiver: Player logs unavailable/);
  assert.equal(ui.byClass(tree, 'gwb-comparison').props.children[0].props.children.props.report.player.id, player.id);
  failing = false;
  ui.byClass(tree, 'gwb-error').props.children[1].props.onClick();
  await new Promise(setImmediate); tree = ui.render();
  assert.equal(ui.byClass(tree, 'gwb-error'), undefined);
  assert.equal(ui.byClass(tree, 'gwb-comparison').props.children[1].props.children.props.report.player.id, secondPlayer.id);
});
test('A replacement clears stale cards immediately and an older request cannot overwrite a newer player', async () => {
  const pending = new Map();
  const ui = botWelcomeHarness({ players: [player, secondPlayer], loadReport(id) {
    return new Promise((resolve) => pending.set(id, resolve));
  } });
  let tree = await ui.search(player.name);
  assert.equal(ui.byClass(tree, 'gwb-conversation').props.children.length, 0);
  tree = await ui.search(secondPlayer.name);
  ui.byClass(tree, 'gwb-search-results').props.children[0][0].props.onClick();
  pending.get(secondPlayer.id)({ ...report(), player: secondPlayer });
  await new Promise(setImmediate); tree = ui.render();
  pending.get(player.id)(report());
  await new Promise(setImmediate); tree = ui.render();
  assert.match(ui.byClass(tree, 'gwb-conversation').props.children[0].props.children[0].props.children, /Other Receiver/);
});
test('A comparison timeout keeps a verified completed outlook and exposes the other player error', async () => {
  let timeOutSecond = false;
  const ui = botWelcomeHarness({ players: [player, secondPlayer], loadReport(id, format, signal) {
    if (timeOutSecond && id === secondPlayer.id) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    return { ...report({ format }), player: id === player.id ? player : secondPlayer };
  } });
  let tree = await ui.search(player.name);
  ui.byClass(tree, 'gwb-compare-button').props.onClick();
  tree = await ui.search(secondPlayer.name);
  timeOutSecond = true;
  ui.find(tree, (node) => node.type === 'select').props.onChange({ target: { value: 'half' } });
  await new Promise(setImmediate); ui.expire();
  await new Promise(setImmediate); tree = ui.render();
  const columns = ui.byClass(tree, 'gwb-comparison').props.children;
  assert.equal(columns[0].props.children.props.report.player.id, player.id);
  assert.equal(columns[0].props.children.props.report.format, 'half');
  assert.match(ui.byClass(tree, 'gwb-error').props.children[0].props.children, /Other Receiver: Player breakdown timed out/);
  assert.doesNotMatch(ui.byClass(tree, 'gwb-error').props.children[0].props.children, /Test Runner:/);
});
test('Estimate cards show receptions with catch units and concise blurbs without the underlying model inputs', async () => {
  const projection = { market: 'player_receptions', label: 'Receptions', unit: 'receptions', estimate: 4.8, yards: null, baseline: 4, playerGames: 3,
    defenseAverage: 10, defenseGames: 5, share: 66.7, historyAverage: null, historyGames: 0, contenderAverage: null, contenderGames: 0,
    context: 'Internal model context', explanation: 'A favorable reception matchup lifts the outlook.', warnings: [], sourceGames: [] };
  const ui = botWelcomeHarness({ loadReport: () => ({ ...report(), projections: [projection] }) });
  const tree = await ui.search(player.name);
  const breakdown = ui.byClass(tree, 'gwb-conversation').props.children[0].props.children[1];
  const rendered = breakdown.type(breakdown.props);
  assert.equal(ui.byClass(rendered, 'gwb-projection-evidence'), undefined);
  const card = ui.byClass(rendered, 'gwb-projection');
  assert.equal(card.props.children.length, 2);
  assert.equal(card.props.children[1].props.children, projection.explanation);
  assert.deepEqual(card.props.children[0].props.children[1].props.children.props.children[0], 4.8);
  assert.match(JSON.stringify(card.props.children[0].props.children[1].props.children.props.children[1].props.children), /catches/);
});
