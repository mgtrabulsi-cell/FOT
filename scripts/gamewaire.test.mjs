import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as engine from '../supabase/functions/_shared/gamewaire.ts';
import * as sources from '../supabase/functions/_shared/gamewaireSources.ts';

const now = Date.parse('2026-10-27T18:00:00Z');
const quote = { key: 'event|player_points|Player|Over|20.5', eventId: 'event', sport: 'NBA',
  start: new Date(now + 86_400_000).toISOString(), home: 'Boston Celtics', away: 'Atlanta Hawks',
  market: 'player_points', subject: 'Player', side: 'Over', line: 20.5, american: 150,
  book: 'Book A', updatedAt: new Date(now - 60_000).toISOString(), noVig: 0.5 };
const settings = { ...engine.defaultSettings, markets: ['player_points', 'player_rebounds', 'h2h'] };
const evidence = { eligible: true, fetchedAt: new Date(now).toISOString(), quality: 0.8, risks: ['Experimental'],
  samples: Array.from({ length: 30 }, (_, index) => ({ date: new Date(now - (index + 1) * 86_400_000).toISOString(), value: index < 27 ? 30 : 10 })) };
const evaluate = (quotes = [quote], data = evidence, options = settings, time = now) => engine.evaluate(quotes, new Map(quotes.map((q) => [q.key, data])), options, time);

test('American conversion, raw implied, no-vig and exact push-aware EV are deterministic', () => {
  assert.equal(engine.decimalOdds(150), 2.5);
  assert.equal(engine.decimalOdds(-200), 1.5);
  assert.equal(engine.impliedProbability(-200), 2 / 3);
  assert.deepEqual(engine.noVigProbabilities([-110, -110]), [0.5, 0.5]);
  assert.ok(Math.abs(engine.expectedValue(0.5, 0.1, 100) - 0.1) < 1e-10);
  assert.equal(engine.expectedValue(0, 1, -110), 0);
  for (const bad of [0, -99, 99, NaN, Infinity]) assert.throws(() => engine.decimalOdds(bad));
  assert.throws(() => engine.expectedValue(0.9, 0.2, 100));
  assert.throws(() => engine.noVigProbabilities([100]));
});

test('Provider quotes preserve exact lines and prices, match two-way markets and choose the best fresh price', () => {
  const raw = { id: 'event', home_team: quote.home, away_team: quote.away, commence_time: quote.start,
    bookmakers: ['A', 'B'].map((book, i) => ({ key: book, title: book, markets: [{ key: 'player_points', last_update: quote.updatedAt,
      outcomes: [{ name: 'Over', description: 'Player', point: 20.5, price: i ? 160 : 150 }, { name: 'Under', description: 'Player', point: 20.5, price: -180 }] }] })) };
  const quotes = engine.readQuotes(raw, 'NBA');
  assert.equal(quotes.length, 4);
  assert.equal(quotes[0].line, 20.5);
  assert.notEqual(quotes[0].noVig, null);
  const result = evaluate(quotes);
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].american, 160);
  assert.equal(result.picks[0].book, 'B');
  assert.equal(evaluate([quote, { ...quote, american: 200, noVig: null }]).picks[0].american, 150,
    'An incomplete better-priced book cannot hide a valid complete two-way offer');
  raw.bookmakers[0].markets[0].outcomes[1].point = 21.5;
  assert.equal(engine.readQuotes(raw, 'NBA')[0].noVig, null, 'Different exact opposing lines never form a no-vig pair');
});

test('Qualifying estimates retain a complete output shape and a moved line is reevaluated, not reused', () => {
  const result = evaluate();
  assert.equal(result.status, 'completed');
  const pick = result.picks[0];
  for (const key of ['projection', 'probability', 'pushProbability', 'implied', 'edge', 'ev', 'conservativeEV', 'quality', 'dataAt', 'modelVersion', 'facts', 'risks', 'samples']) assert.ok(key in pick);
  assert.equal(pick.sampleSize, 30);
  assert.ok(pick.ev > 0 && pick.conservativeEV > 0);
  assert.equal(evaluate([{ ...quote, line: 35.5 }]).picks.length, 0);
  assert.equal(evaluate([{ ...quote, american: -1000 }]).picks.length, 0);
});

test('The engine abstains for missing, stale, future, incomplete, unverified and early-season data', () => {
  for (const change of [
    { eligible: false }, { quality: 0.4 }, { samples: [] }, { samples: evidence.samples.slice(0, 11) },
    { fetchedAt: new Date(now - 3_600_001).toISOString() }, { fetchedAt: 'invalid' },
    { samples: [{ date: new Date(now + 1).toISOString(), value: 30 }, ...evidence.samples] },
  ]) assert.equal(evaluate([quote], { ...evidence, ...change }).picks.length, 0);
  assert.equal(evaluate([{ ...quote, updatedAt: new Date(now - 600_001).toISOString() }]).status, 'stale_odds');
  assert.equal(evaluate([{ ...quote, start: new Date(now).toISOString() }]).picks.length, 0);
  assert.equal(evaluate([{ ...quote, noVig: null }]).picks.length, 0);
  const allPushes = { ...evidence, samples: evidence.samples.map((row) => ({ ...row, value: 20 })) };
  assert.equal(evaluate([{ ...quote, line: 20 }], allPushes).picks.length, 0, 'Floating-point push mass never exceeds one or claims positive EV');
});

test('Settings affect actual selection, minimum quality, recent weighting and direction', () => {
  assert.equal(evaluate([quote], evidence, { ...settings, direction: 'under' }).picks.length, 0);
  assert.equal(evaluate([quote], evidence, { ...settings, player: 'Another player' }).picks.length, 0);
  assert.equal(evaluate([quote], evidence, { ...settings, minQuality: 0.9 }).picks.length, 0);
  assert.equal(evaluate([{ ...quote, american: 100 }], evidence, { ...settings, minEV: 1 }).picks.length, 0);
  assert.notEqual(evaluate([quote], evidence, { ...settings, recentWeight: 0 }).picks[0].probability,
    evaluate([quote], evidence, { ...settings, recentWeight: 0.6 }).picks[0].probability);
  assert.throws(() => engine.readSettings({ ...settings, markets: ['invented'] }, 'NBA'));
  assert.throws(() => engine.readSettings({ ...settings, markets: ['h2h', 'h2h'] }, 'NBA'));
  assert.throws(() => engine.readSettings({ ...settings, minQuality: 0.1 }, 'NBA'));
});

test('Duplicate player markets and team markets are controlled without forcing four picks', () => {
  const quotes = [quote, { ...quote, key: 'same-player-rebounds', market: 'player_rebounds', line: 3.5 },
    { ...quote, key: 'different-player', subject: 'Another player' }];
  const result = evaluate(quotes);
  assert.equal(result.picks.length, 2);
  assert.equal(new Set(result.picks.map((pick) => pick.subject)).size, 2);
  assert.ok(result.rejected.some((row) => row.reason.includes('correlated')));
  const teamQuotes = ['Boston Celtics', 'Atlanta Hawks'].map((team) => ({ ...quote, key: team, subject: team, side: team, market: 'h2h', line: null }));
  assert.equal(evaluate(teamQuotes).picks.length, 1);
  const many = Array.from({ length: 12 }, (_, i) => ({ ...quote, key: `player-${i}`, subject: `Player ${i}` }));
  const data = new Map(many.map((q) => [q.key, evidence]));
  assert.equal(engine.evaluate(many, data, settings, now, 8).picks.length, 8);
  assert.equal(engine.evaluate(many, data, settings, now).picks.length, 4);
  assert.equal(engine.evaluate(many, new Map(many.map((q) => [q.key, { ...evidence, samples: [] }])), settings, now, 8).picks.length, 0);
});

test('GamewAIre grade is a bounded transparent rubric, not a probability', () => {
  assert.deepEqual(engine.gamewaireGrade({ conservativeEV: 0.15, edge: 0.15, ev: 0.25, quality: 1 }), { score: 100, letter: 'A' });
  assert.deepEqual(engine.gamewaireGrade({ conservativeEV: 0, edge: 0, ev: 0, quality: 0 }), { score: 0, letter: 'D' });
  assert.equal(engine.gamewaireGrade({ conservativeEV: 10, edge: 10, ev: 10, quality: 1 }).score, 100);
  const low = { conservativeEV: 0.01, edge: 0.03, ev: 0.05, quality: 0.8 };
  assert.ok(engine.gamewaireGrade({ ...low, conservativeEV: 0.1 }).score > engine.gamewaireGrade(low).score);
});

test('Adjusted team forecasts retain real observed averages and valid point/push outcomes', () => {
  const team = { ...quote, market: 'spreads', side: 'Boston Celtics', line: -28.5 };
  const pick = evaluate([team], { ...evidence, adjustment: -1.5 }, { ...settings, markets: ['spreads'] }).picks[0];
  assert.ok(pick);
  assert.equal(pick.pushProbability, 0, 'Half-point spreads cannot push after a fractional opponent adjustment');
  assert.equal(pick.last5, 30, 'Historical averages remain actual, unadjusted observations');
  assert.equal(pick.seasonAverage, 28);
  const moneyline = { ...team, market: 'h2h', line: null };
  const tied = { ...evidence, samples: evidence.samples.map((row, i) => ({ ...row, value: i < 27 ? 30 : 0 })) };
  assert.equal(evaluate([moneyline], tied).picks[0].pushProbability, 0, 'NBA moneylines do not return a modeled tie as a push');
});

test('Performance includes losses, pushes, withdrawals, real prices, calibration and closing price value', () => {
  const rows = [
    { probability: 0.6, pushProbability: 0, american: 150, result: 'win', closingAmerican: 100 },
    { probability: 0.6, pushProbability: 0, american: -200, result: 'loss', withdrawn: true },
    { probability: 0.5, pushProbability: 0.1, american: -110, result: 'push' },
    { probability: 0.5, pushProbability: 0, american: 100, result: 'pending' },
  ];
  const result = engine.performance(rows);
  assert.equal(result.total, 4); assert.equal(result.settled, 3); assert.equal(result.profit, 0.5);
  assert.equal(result.roi, 0.5 / 3); assert.equal(result.winRate, 0.5); assert.equal(result.withdrawn, 1);
  assert.ok(Math.abs(result.brier - 0.26) < 1e-10); assert.equal(result.closingPriceValue, 0.25);
  assert.equal(engine.performance([]).roi, null);
  const groups = engine.performanceGroups(rows.map((row) => ({ ...row, sport: 'NBA', market: 'player_points', edge: 0.05, createdAt: quote.updatedAt })));
  assert.equal(groups.sport[0].total, 4);
  assert.equal(groups.price.length, 2);
});

test('Historical replay is separate and rejects future odds, observations and post-cutoff data snapshots', () => {
  const item = { quote, evidence, asOf: new Date(now).toISOString(), outcome: 'loss' };
  const result = engine.replayBacktest([item], settings);
  assert.equal(result.total, 1); assert.equal(result.profit, -1); assert.match(result.label, /simulation/);
  assert.equal(result.benchmarks.market.total, 1);
  assert.equal(engine.replayBacktest([item, item], settings).total, 1, 'A repeated archived quote does not create multiple simulated wagers');
  assert.throws(() => engine.replayBacktest([item, { ...item, outcome: 'win' }], settings), /conflicting outcomes/);
  assert.throws(() => engine.replayBacktest([{ ...item, outcome: 'invented' }], settings), /valid settled outcome/);
  for (const change of [
    { quote: { ...quote, updatedAt: new Date(now + 1).toISOString() } },
    { evidence: { ...evidence, fetchedAt: new Date(now + 1).toISOString() } },
    { evidence: { ...evidence, samples: [{ date: new Date(now).toISOString(), value: 30 }] } },
  ]) assert.throws(() => engine.replayBacktest([{ ...item, ...change }], settings), /future information/);
});

test('Sports adapters preserve real zero, made-attempted threes, minutes, completed regular-season games and cutoff', () => {
  const value = { names: ['points', 'minutes', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], events: {
    one: { gameDate: '2026-10-26T20:00:00Z' }, future: { gameDate: '2026-10-28T20:00:00Z' },
  }, seasonTypes: [{ displayName: '2026-27 Regular Season', categories: [{ events: [
    { eventId: 'one', stats: ['0', '32:30', '2-7'] }, { eventId: 'future', stats: ['90', '48', '10-10'] },
  ] }] }] };
  assert.equal(sources.playerSamples(value, 'player_points', now)[0].value, 0);
  assert.equal(sources.playerSamples(value, 'player_threes', now)[0].value, 2);
  assert.equal(sources.playerSamples(value, 'player_points', now)[0].minutes, 32.5);
  assert.equal(sources.playerSamples(value, 'player_points', now).length, 1);
  assert.throws(() => sources.playerSamples(value, 'player_assists', now), /does not report/);
  const teams = sources.teamSamples({ events: [{ date: '2026-10-26T20:00:00Z', seasonType: { type: 2 }, competitions: [{
    status: { type: { completed: true } }, competitors: [{ team: { id: '1' }, score: { value: 100 } }, { team: { id: '2' }, score: { value: 90 } }],
  }] }] }, '1', now);
  assert.equal(teams[0].margin, 10); assert.equal(teams[0].total, 190);
});

test('Evidence deduplicates shared event IDs, not coincidental same-date scores, and rejects inactive injuries', async () => {
  const matchup = { eventId: 'espn-event', season: 2027, home: { id: '1', name: quote.home }, away: { id: '2', name: quote.away } };
  const fetcher = async (url) => {
    const id = String(url).match(/teams\/(\d+)/)?.[1];
    if (String(url).includes('/schedule')) return Response.json({ events: Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? 'shared' : `${id}-${i}`, date: new Date(now - (i + 1) * 86_400_000).toISOString(), seasonType: { type: 2 },
      competitions: [{ status: { type: { completed: true } }, competitors: [
        { team: { id, displayName: id === '1' ? quote.home : quote.away }, score: 100 },
        { team: { id: id === '1' ? '2' : '1', displayName: 'Opponent' }, score: 90 },
      ] }],
    })) });
    if (String(url).includes('/roster')) return Response.json({ athletes: id === '1' ? [
      { id: 'player', displayName: 'Player', status: { type: 'active' }, injuries: [{ status: 'Inactive' }] },
    ] : [] });
    throw new Error('Inactive players must not trigger game-log retrieval');
  };
  const total = { ...quote, key: 'total', market: 'totals', side: 'Over', line: 180.5 };
  const data = await sources.collectEvidence([total, quote], matchup, now, fetcher);
  assert.equal(data.evidence.get(total.key).samples.length, 23);
  assert.equal(data.evidence.get(quote.key).eligible, false);
  assert.ok(data.warnings.some((warning) => warning.includes('injury availability')));
});

test('Matchup resolution uses supported individual scoreboard dates and deduplicates boundary games', async () => {
  const requests = [];
  const matchup = await sources.resolveMatchup(quote, async (url) => {
    requests.push(String(url));
    const dates = new URL(url).searchParams.get('dates');
    assert.match(dates, /^\d{8}$/, 'NBA scoreboard does not support a multi-day range');
    return Response.json({ events: [{ id: 'espn-event', date: quote.start, season: { year: 2027 },
      competitions: [{ status: { type: { state: 'pre' } }, competitors: [
        { homeAway: 'home', team: { id: '2', displayName: quote.home } },
        { homeAway: 'away', team: { id: '17', displayName: quote.away } },
      ] }] }] });
  });
  assert.equal(requests.length, 2);
  assert.equal(matchup.eventId, 'espn-event');
});

test('GamewAIre navigation is ordered correctly and AI styling is bold red without loading the engine at startup', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const nav = source.slice(source.indexOf('<PrimaryNavigation>'), source.indexOf('</PrimaryNavigation>'));
  assert.ok(nav.indexOf("setView('Analyst')") < nav.indexOf("setView('Gamewaire')"));
  assert.ok(nav.indexOf("setView('Gamewaire')") < nav.indexOf("setView('LiveWire')"));
  assert.match(nav, /Gamew<strong>AI<\/strong>re/);
  assert.match(source, /lazy\(\(\) => import\('\.\/Gamewaire'\)\)/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.gamewaire-name strong \{ color: #ff5965; font-weight: 900;/);
});

test('GamewAIre renders provider setup, real reports and complete metrics without fabricated empty-state picks', async () => {
  const raw = readFileSync(new URL('../src/Gamewaire.tsx', import.meta.url), 'utf8');
  const component = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/import ['"]\.\/gamewaire\.css['"];/, '')
    .replace(/import \{ useEffect, useState \} from ['"]react['"];/, `let slot = 0, states = []; export const fixture = (values) => { states=values; slot=0; }; const useEffect=()=>{}; const useState=(initial)=>[slot in states?states[slot++]:((slot++),typeof initial==='function'?initial():initial),()=>{}];`)
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`)
    .replace(/import \{[^;]+\} from ['"]\.\/services\/gamewaire['"];/, `import { defaultSettings, markets, performance, performanceGroups, gamewaireGrade } from '${new URL('../supabase/functions/_shared/gamewaire.ts', import.meta.url)}'; const engineRequest=()=>{}; const loadEngineHistory=()=>{};`)
    .replace(/import \{ nbaCalendarDate \} from [^;]+;/, `const nbaCalendarDate=(date=new Date())=>date.toISOString().slice(0,10);`)
    .replace(/import \{ subscribeForegroundRefresh \} from [^;]+;/, 'const subscribeForegroundRefresh=()=>()=>{};');
  const { default: Page, fixture } = await import(`data:text/javascript;base64,${Buffer.from(component).toString('base64')}`);
  const status = { canAnalyze: true, oddsReady: false, aiReady: false, model: engine.modelVersion, experimental: true };
  fixture([status, [], [], true]);
  const empty = renderToStaticMarkup(createElement(Page));
  assert.match(empty, /Gamew<strong>AI<\/strong>re/);
  assert.match(empty, /Sportsbook analysis is unavailable/);
  assert.match(empty, /No model analyses yet/);
  assert.doesNotMatch(empty, /class="gai-pick/);
  assert.match(empty, /disabled=""[^>]*>Load upcoming games/);
  const candidate = evaluate().picks[0];
  const run = { id: 'run', matchup: 'Away at Home', created_at: quote.updatedAt, status: 'completed', payload: { picks: [candidate], warnings: [] } };
  const pick = { ...candidate, id: 'pick', event_start: quote.start, created_at: quote.updatedAt, push_probability: candidate.pushProbability,
    result: 'loss', data: candidate, closing_american: null, withdrawn: true, revision: 1 };
  const memberState = [{ ...status, canAnalyze: false, oddsReady: true }, [run], [pick], true];
  memberState[22] = [{ sport: 'NBA', event_id: 'event', event_start: quote.start, matchup: 'Away at Home', picks: [candidate], published_at: quote.updatedAt }];
  memberState[23] = 'event'; memberState[25] = quote.start.slice(0, 10);
  fixture(memberState);
  const report = renderToStaticMarkup(createElement(Page));
  assert.match(report, /class="gai-pick angle-card"/);
  assert.match(report, /Book A/);
  assert.match(report, /loss/);
  assert.match(report, /withdrawn/);
  assert.doesNotMatch(report, /Admin analysis controls/);
  assert.doesNotMatch(report, /Saved analysis reports|Choose up to four member picks/);
  assert.match(report, /GamewAIre grade/);
  assert.match(report, /Estimated win probability \(unvalidated\)/);
  assert.match(report, /Brier score/);
  fixture([status, [run], [], true]);
  const admin = renderToStaticMarkup(createElement(Page));
  assert.match(admin, /Choose up to four member picks/);
  assert.match(admin, /Publish 0\/4 picks/);
  assert.match(admin, /ODDS_API_KEY/);
});

const endpointSource = readFileSync(new URL('../supabase/functions/gamewaire/index.ts', import.meta.url), 'utf8')
  .replace(/if \(import\.meta\.main\) Deno\.serve[^;]+;/, '');
const endpointCode = ts.transpileModule(endpointSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function endpoint({ role = 'admin', configured = false, failClaim = false } = {}) {
  const rpc = [], tables = [], fetches = [], env = { get: (name) => ({
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    ...(configured ? { ODDS_API_KEY: 'fixture-odds' } : {}),
  })[name] };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin-fixture' } }, error: null }) },
    from(table) {
      tables.push(table);
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder, lt: () => builder,
        update: () => builder, insert: (value) => { builder.value = value; return builder; },
        upsert: () => builder,
        maybeSingle: async () => ({ data: table === 'livewire_roles' ? { role } : null, error: null }),
        single: async () => ({ data: { ...builder.value, id: 'run-fixture' }, error: null }),
        then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
    rpc: async (name, args) => { rpc.push({ name, args }); return { data: name === 'gamewaire_claim' ? !failClaim : null, error: null }; },
  };
  const fetcher = async (url) => {
    fetches.push(String(url));
    return Response.json({ id: 'event', home_team: quote.home, away_team: quote.away, commence_time: quote.start,
      bookmakers: [{ key: 'book', title: 'Book', markets: [{ key: 'player_points', last_update: quote.updatedAt,
        outcomes: [{ name: 'Over', description: 'Player', point: 20.5, price: 150 }, { name: 'Under', description: 'Player', point: 20.5, price: -180 }] }] }] });
  };
  const context = vm.createContext({ exports: {}, Response, Request, URL, AbortSignal, Date: class extends Date { static now() { return now; } }, console,
    require(name) {
      if (name.startsWith('npm:')) return { createClient: () => client };
      if (name.includes('gamewaireSources')) return { ...sources, resolveMatchup: async () => ({}), collectEvidence: async (quotes) => ({
        evidence: new Map(quotes.map((q) => [q.key, evidence])), warnings: [], coverage: {},
      }) };
      return engine;
    },
  });
  vm.runInContext(endpointCode, context);
  return { rpc, tables, fetches, run: (body, auth = true, customFetcher = fetcher) => context.exports.handleGamewaire(new Request('https://test/engine', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
  }), env, customFetcher), exports: context.exports };
}
test('Endpoint requires authentication/admin access and honestly reports unconfigured providers', async () => {
  const api = endpoint();
  assert.equal((await api.run({ action: 'status' }, false)).status, 401);
  const status = await (await api.run({ action: 'status' })).json();
  assert.equal(status.oddsReady, false); assert.equal(status.aiReady, false);
  assert.equal((await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 503);
  assert.equal(api.fetches.length, 0, 'No invented response or paid call without credentials');
  const member = endpoint({ role: 'member', configured: true });
  assert.equal((await member.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 403);
  assert.equal(member.fetches.length, 0);
  assert.equal((await member.run({ action: 'publish', runId: '00000000-0000-0000-0000-000000000001', keys: [quote.key] })).status, 403);
});
test('Publication is admin-only, rejects invalid counts, and uses the transactional publication RPC', async () => {
  const api = endpoint();
  const runId = '00000000-0000-0000-0000-000000000001';
  for (const keys of [[], [quote.key, quote.key], [1], ['a', 'b', 'c', 'd', 'e']]) {
    assert.equal((await api.run({ action: 'publish', runId, keys })).status, 400);
  }
  assert.equal((await api.run({ action: 'publish', runId, keys: [quote.key] })).status, 200);
  assert.equal(api.rpc.at(-1).name, 'gamewaire_publish');
  assert.equal(api.rpc.at(-1).args.selected_keys[0], quote.key);
  assert.equal(api.fetches.length, 0, 'Publishing a prepared report never triggers a paid call');
});
test('Endpoint rate limits before paid API calls and persists deterministic complete reports transactionally', async () => {
  const limited = endpoint({ configured: true, failClaim: true });
  assert.equal((await limited.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings })).status, 429);
  assert.equal(limited.fetches.length, 0);
  const api = endpoint({ configured: true });
  const response = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.run.status, 'completed');
  assert.equal(api.rpc.at(-1).name, 'gamewaire_finish');
  assert.ok(api.rpc.at(-1).args.candidates.length > 0);
  assert.ok(body.run.payload.warnings.some((warning) => warning.includes('OPENAI_API_KEY')));
  const filtered = await endpoint({ configured: true }).run({ action: 'analyze', sport: 'NBA', eventId: 'event',
    settings: { ...settings, markets: ['player_points'], player: 'No matching player' } });
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).run.status, 'no_qualifying', 'An empty player filter is an abstention, not a provider failure');
});
test('Provider errors, invalid lines and AI failures remain explicit; AI only selects supplied factual phrases', async () => {
  const api = endpoint({ configured: true });
  const error = await api.run({ action: 'analyze', sport: 'NBA', eventId: 'event', settings }, true, async () => new Response('', { status: 429 }));
  assert.equal(error.status, 502); assert.match((await error.json()).error, /rate limit/);
  const picks = evaluate().picks;
  await api.exports.explain(picks, 'fixture-ai', 'fixture-model', async () => Response.json({ choices: [{ message: {
    content: JSON.stringify({ selections: [{ key: picks[0].key, facts: [0, 1], risks: [0] }] }),
  } }] }));
  assert.equal(picks[0].explanation, `${picks[0].facts[0]} ${picks[0].facts[1]} ${picks[0].risks[0]}`);
  await assert.rejects(api.exports.explain(picks, 'fixture-ai', 'fixture-model', async () => Response.json({ choices: [{ message: { content: '{"selections":[]}' } }] })), /incomplete/);
});

test('Edge source type-checks against existing Supabase types without installing tools', () => {
  const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
  const shim = `${root}gamewaire-test-runtime.d.ts`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, types: [] };
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.fileExists = (name) => name === shim || exists(name);
  host.readFile = (name) => name === shim ? 'interface ImportMeta { main?: boolean } declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };' : read(name);
  host.resolveModuleNames = (names, containing) => names.map((name) => ts.resolveModuleName(name.startsWith('npm:') ? '@supabase/supabase-js' : name, containing, options, host).resolvedModule);
  const program = ts.createProgram([`${root}supabase/functions/gamewaire/index.ts`, shim], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => '\n' }));
});
