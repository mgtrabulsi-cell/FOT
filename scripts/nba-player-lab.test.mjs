import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { nbaStatValue } from '../src/services/nbaStats.ts';
import { parseNBAStatRow } from '../src/services/nbaData.ts';

const range = mean => ({ mean, p10: Math.max(0, mean - 3), p90: mean + 3 });
const athlete = (id, teamId, pra) => ({ id, teamId, name: `Player ${id}`, position: 'G', excluded: false,
  status: 'Active', games: 40, limited: false, matchup: 'Verified opponent adjustment',
  stats: { points: range(pra - 10), rebounds: range(5), assists: range(5), minutes: range(34), pra: range(pra) } });
const away = { id: '1', name: 'Away Team', abbr: 'AWY', color: '#123456' };
const home = { id: '2', name: 'Home Team', abbr: 'HME', color: '#654321' };
const player = { ...athlete('11', away.id, 40), team: away };
const forecast = { eventId: '900', status: 'ready', kickoff: '2026-10-24T23:00:00Z', forecastAt: '2026-10-24T20:00:00Z',
  stage: 'Ready', warnings: [], away: { ...away, score: range(115), winProbability: .6,
    players: [12, 45, 28, 62, 18, 38, 51].map((pra, index) => athlete(String(index + 10), away.id, pra)) },
  home: { ...home, score: range(109), winProbability: .4, players: [athlete('20', home.id, 22)] } };
function moduleFor(path, imports) {
  const context = vm.createContext({ exports: {}, AbortController, console, Date, Error, setTimeout, clearTimeout,
    require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected dependency ${name}`); } });
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInContext(code, context);
  return context.exports;
}
function service(overrides = {}) {
  const cached = new Map(), league = { season: 2027, teams: [away, home] };
  cached.set('nbaLeague:nba-league', league);
  cached.set(`nbaRoster:roster:${away.id}:2027`, [player]);
  const profile = { averages: { points: 25, rebounds: 5, assists: 7 }, totals: {}, games: [
    { id: 'prior', date: '2026-10-23T23:00:00Z', stats: { points: 0, rebounds: 0, assists: 0, threePointersMade: 0 } },
    { id: 'older', date: '2026-10-22T23:00:00Z', stats: { points: 30, rebounds: 10, assists: 10 } },
    { id: 'after', date: '2026-10-25T23:00:00Z', stats: { points: 99, rebounds: 0, assists: 0 } },
  ] };
  const game = { eventId: '900', date: forecast.kickoff, home, away };
  const requests = [];
  const api = moduleFor('../src/services/nbaPlayerLab.ts', {
    './nbaStats.ts': { nbaStatValue },
    './nbaData.ts': { fetchNBALeague: async () => league, fetchNBARoster: async id => [{ ...player, teamId: id }],
      fetchNBAPlayerProfile: async () => profile, ...overrides.data },
    './sportsData.ts': { nbaCalendarDate: () => '2026-10-24', fetchNBAScoreboard: async () => [game], ...overrides.sports },
    './renderSnapshots.ts': { readLastNBAStatHub: () => null, readRenderSnapshot: (kind, key) => cached.get(`${kind}:${key}`) ?? null,
      saveRenderSnapshot: (kind, key, value) => cached.set(`${kind}:${key}`, value) },
    './nbaSimulation.ts': { readSavedNBASimulation: async () => forecast, loadNBASimulation: async (game, signal) => {
      requests.push({ game, signal }); return forecast;
    }, ...overrides.simulation },
  });
  return { api, cached, profile, requests, game };
}
test('NBA PRA derives from complete reported components, including old saved profiles and genuine zeros', () => {
  assert.equal(nbaStatValue({ points: 20, rebounds: 7, assists: 9 }, 'pra'), 36);
  assert.equal(nbaStatValue({ points: 0, rebounds: 0, assists: 0 }, 'pra'), 0);
  assert.equal(nbaStatValue({ points: 20, rebounds: 7, pra: 99 }, 'pra'), undefined);
  assert.equal(nbaStatValue({ points: NaN, rebounds: 7, assists: 9 }, 'pra'), undefined);
  assert.equal(nbaStatValue({ threePointersMade: 0 }, 'threePointersMade'), 0);
  for (const name of ['threePointFieldGoalsMade', 'avgThreePointFieldGoalsMade', '3PM']) {
    assert.equal(parseNBAStatRow([name], ['0']).threePointersMade, 0);
    assert.equal(parseNBAStatRow([name], ['2.5']).threePointersMade, 2.5);
  }
});
test('NBA Player Lab searches cached rosters immediately and progressively refreshes teams without profile fanout', async () => {
  let profileCalls = 0;
  const { api } = service({ data: { fetchNBAPlayerProfile() { profileCalls++; throw new Error('Directory must not fetch profiles'); } } });
  assert.equal(api.readNBAPlayerLabDirectory().players[0].name, player.name);
  const updates = [], result = await api.loadNBAPlayerLabDirectory(new AbortController().signal, data => updates.push(data.players.length));
  assert.equal(result.players.length, 2);
  assert.ok(updates.includes(1));
  assert.equal(profileCalls, 0);
});
test('NBA partial roster errors retain cached players and expose the failing team', async () => {
  const { api } = service({ data: { fetchNBARoster: async id => { if (id === away.id) throw new Error('Feed unavailable'); return [player]; } } });
  const result = await api.loadNBAPlayerLabDirectory(new AbortController().signal, () => {});
  assert.ok(result.players.some(row => row.teamId === away.id));
  assert.match(result.issues.join(' '), /AWY.*Feed unavailable/);
});
test('NBA Player Lab reuses the saved authenticated model for the correct player and leaves absent players unsupported', async () => {
  const { api, requests, game } = service();
  const report = await api.loadNBAPlayerLabReport(player, 2027, new AbortController().signal);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].game, game);
  assert.equal(report.projection.id, player.id);
  assert.equal(report.forecastAt, forecast.forecastAt);
  const unsupported = await api.loadNBAPlayerLabReport({ ...player, id: '999' }, 2027, new AbortController().signal);
  assert.equal(unsupported.projection, null);
});
test('NBA model refresh errors preserve the saved forecast with an explicit warning; offline stats remain available', async () => {
  const { api, cached, profile } = service({ data: { fetchNBAPlayerProfile: async () => { throw new Error('Stats offline'); } },
    simulation: { loadNBASimulation: async () => { throw new Error('Model offline'); } } });
  cached.set(`nbaProfile:profile:${player.id}:2027`, profile);
  const report = await api.loadNBAPlayerLabReport(player, 2027, new AbortController().signal);
  assert.equal(report.profile, profile);
  assert.equal(report.projection.id, player.id);
  assert.match(report.issues.join(' '), /Stats offline.*Model offline/);
});
test('NBA stat questions exclude post-matchup appearances, preserve missing threes and never invent probabilities', () => {
  const { api, profile, game } = service();
  const report = { player, profile, game, projection: player };
  const pra = api.nbaPlayerLabAnswer(report, 'pra', 30.5);
  assert.deepEqual(JSON.parse(JSON.stringify(pra)), { estimate: 40, low: 37, high: 43, games: 2, over: 1, under: 1, pushes: 0 });
  const threes = api.nbaPlayerLabAnswer(report, 'threePointersMade', 0);
  assert.equal(threes.games, 1);
  assert.equal(threes.pushes, 1);
  assert.equal(threes.estimate, null);
  assert.ok(!('probability' in threes));
  assert.throws(() => api.nbaPlayerLabAnswer(report, 'pra', NaN), /supported statistic/);
  assert.throws(() => api.nbaPlayerLabAnswer(report, 'minutes', 30), /supported statistic/);
});
const graphics = () => moduleFor('../src/services/nbaMatchupGraphic.ts', {
  './gamewaireResultsGraphic': {}, '../TeamAbbrMark': {},
});
test('NBA matchup graphics select exactly five per team by archived projected PRA, not actual performance', () => {
  const actuals = { away: { id: away.id, score: 118, players: { '10': { points: 100, rebounds: 10, assists: 10 } } },
    home: { id: home.id, score: 110, players: { '20': { points: 0, rebounds: 0, assists: 0, threePointers: 0 } } } };
  const sourceOrder = forecast.away.players.map(row => row.id);
  const [a, h] = graphics().nbaMatchupGraphicData(forecast, actuals);
  assert.equal(a.players.length, 5);
  assert.deepEqual(Array.from(a.players, row => row.stats.pra.mean), [62, 51, 45, 38, 28]);
  assert.equal(a.players[0].actual, undefined, 'Missing actual line is unavailable, not zero');
  assert.equal(h.players[0].actual.points, 0);
  assert.equal(a.finalScore, 118);
  assert.deepEqual(forecast.away.players.map(row => row.id), sourceOrder);
  assert.throws(() => graphics().nbaMatchupGraphicData({ ...forecast, status: 'collecting' }), /ready, saved/);
  assert.throws(() => graphics().nbaMatchupGraphicData(forecast, { ...actuals, home: { ...actuals.home, id: away.id } }), /do not match/);
});
test('Wire live indicators remain red without live-only red card borders, retaining keyboard focus', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../src/sports-theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css + theme, /(?:wire-board-card|wire-wheel-card)(?:\.is-primetime)?\.is-live\s*\{/);
  assert.match(css, /\.wire-board-status \.live-pill \{[^}]*color: #ff4d5a/);
  assert.match(css, /\.wire-board-card:focus-visible \{[^}]*outline:/);
});

function chat() {
  return moduleFor('../src/services/playerLabChat.ts', {
    './gamewireBot': {}, './nbaPlayerLab': { nbaPlayerLabAnswer: service().api.nbaPlayerLabAnswer }, './nbaStats': { nbaStatValue },
  });
}
test('One chat matches both sports, disambiguates surnames, supports partial search and preserves cross-sport identities', () => {
  const { findLabPlayers, labPlayerKey, labFollowup } = chat();
  const players = [
    { sport: 'NFL', player: { id: '1', teamId: '1', name: 'Josh Allen' } },
    { sport: 'NBA', player: { id: '1', teamId: '1', name: 'Jarrett Allen' }, season: 2027 },
    { sport: 'NBA', player: { id: '2', teamId: '2', name: 'LeBron James' }, season: 2027 },
  ];
  assert.equal(findLabPlayers('What is Josh Allen projected for?', players)[0].sport, 'NFL');
  assert.equal(findLabPlayers("Show LeBron James's matchup", players)[0].sport, 'NBA');
  assert.equal(findLabPlayers('Allen', players).length, 2);
  assert.equal(findLabPlayers('NBA Allen', players)[0].player.name, 'Jarrett Allen');
  assert.equal(findLabPlayers('LeBr', players)[0].player.name, 'LeBron James');
  assert.equal(findLabPlayers('Compare NFL Josh Allen and NBA LeBron James', players).length, 2);
  assert.notEqual(labPlayerKey(players[0]), labPlayerKey(players[1]));
  assert.equal(labFollowup('What about his recent stats?'), true);
  assert.equal(labFollowup('Over 30.5 PRA?'), true);
  assert.equal(labFollowup('Tell me about Unknown Person'), false);
});

test('Shared player search includes first names even when another player has that surname', () => {
  const { findLabPlayers } = chat();
  const players = [
    { sport: 'NBA', player: { id: '1', teamId: '1', name: 'LeBron James' }, season: 2027 },
    { sport: 'NFL', player: { id: '2', teamId: '2', name: 'James Cook' } },
    { sport: 'NBA', player: { id: '3', teamId: '3', name: 'James Harden' }, season: 2027 },
    { sport: 'NFL', player: { id: '4', teamId: '4', name: 'Josh Allen' } },
  ];
  assert.deepEqual(Array.from(findLabPlayers('James', players), entry => entry.player.name),
    ['LeBron James', 'James Cook', 'James Harden']);
  assert.equal(findLabPlayers('jAm', players).length, 3);
  assert.equal(findLabPlayers('NFL James', players)[0].player.name, 'James Cook');
  assert.equal(findLabPlayers('Josh', players)[0].player.name, 'Josh Allen');
  assert.equal(findLabPlayers('LeBron', players)[0].player.name, 'LeBron James');
});
test('Conversational NBA stat lines ignore the 3 in 3-pointers and retain saved model versus observed distinctions', () => {
  const { chatStatLine, nbaChatAnswer } = chat(), { profile, game } = service();
  assert.equal(chatStatLine('Will he get 3.5 3-pointers?'), 3.5);
  assert.equal(chatStatLine('What about his 3-pointers?'), null);
  assert.equal(chatStatLine('Show his last 5 games'), null);
  const report = { player, profile, game, projection: player, issues: [] };
  assert.match(nbaChatAnswer(report, 'Over 30.5 PRA?').text.join(' '), /estimate: 40.*1 over \/ 1 under.*not forecast probabilities/);
  assert.match(nbaChatAnswer(report, 'Over 2.5 threes?').text.join(' '), /No verified matchup estimate.*1 recorded/);
  assert.match(nbaChatAnswer(report, 'Is he playing?').text.join(' '), /Saved availability.*not a live injury feed/);
});

test('One real chat component keeps NFL, NBA and remembered-player follow-ups in the same conversation', async () => {
  const states = [], refs = [], calls = [];
  let stateIndex = 0, refIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const nfl = { id: '1', teamId: '1', name: 'Josh Allen', teamAbbr: 'BUF', position: 'QB' };
  const nba = { ...player, id: '1', name: 'LeBron James' };
  const api = moduleFor('../src/PlayerLabChat.tsx', {
    react: {
      useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
        return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
      useRef(initial) { return refs[refIndex++] ??= { current: initial }; }, useEffect() {},
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './services/gamewireBot': { readDirectorySnapshot: () => ({ players: [nfl] }) },
    './services/nbaPlayerLab': { readNBAPlayerLabDirectory: () => ({ season: 2027, players: [nba] }) },
    './services/playerLabChat': { ...chat(), async loadLabAnswer(entry, question, format) {
      calls.push({ entry, question, format }); return { text: [`Verified ${entry.sport} answer for ${entry.player.name}`] };
    } },
    './services/nbaStats': { nbaStatValue }, './services/renderSnapshots': {}, './services/foregroundRefresh': {},
  });

  const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
  const render = () => { stateIndex = 0; refIndex = 0; return walk(api.default({ renderNFL: () => null })); };
  let nodes = render();
  nodes.find(node => node.props?.['aria-controls'] === 'gwb-chat-panel').props.onClick();
  async function send(question) {
    nodes = render();
    nodes.find(node => node.type === 'textarea').props.onChange({ target: { value: question } });
    nodes = render(); nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate); nodes = render();
  }
  await send('Show Josh Allen passing yards');
  await send("Show LeBron James's matchup");
  await send('Over 30.5 PRA?');
  assert.deepEqual(calls.map(call => call.entry.sport), ['NFL', 'NBA', 'NBA']);
  assert.equal(calls[2].entry.player.name, 'LeBron James');
  assert.equal(nodes.filter(node => node.props?.className === 'gwb-chat-thread').length, 1);
  assert.equal(nodes.filter(node => node.props?.className === 'gwb-chat-message is-user').length, 3);
  assert.equal(nodes.filter(node => node.props?.className === 'gwb-chat-message is-assistant').length, 3);
  assert.ok(!nodes.some(node => node.props?.['aria-label'] === 'Player Lab league'), 'No separate sport tabs');
});

test('Primary Player Lab restores direct cards with one NFL/NBA search, scoring and comparison', async () => {
    const states = [], refs = [], calls = [];
    let stateIndex = 0, refIndex = 0;
    const jsx = (type, props) => ({ type, props });
    const nfl = { id: '1', name: 'Josh Allen', teamAbbr: 'BUF', position: 'QB' };
    const nba = { ...player, id: '1', name: 'LeBron James' };
    const report = { player: nba, season: 2027, profile: null, game: null, projection: null, forecastAt: null, issues: ['Source offline'] };
    const api = moduleFor('../src/PlayerLabCards.tsx', {
      react: {
        useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
          return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
        useRef(initial) { return refs[refIndex++] ??= { current: initial }; }, useEffect() {},
      },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'lucide-react': {},
      './services/gamewireBot': { readDirectorySnapshot: () => ({ players: [nfl] }),
        async loadBotReport(id, format) { calls.push(['NFL', id, format]); return { player: nfl, format }; } },
      './services/nbaPlayerLab': { readNBAPlayerLabDirectory: () => ({ season: 2027, players: [nba] }),
        async loadNBAPlayerLabReport(row, season) { calls.push(['NBA', row.id, season]); return report; } },
      './services/playerLabChat': chat(), './services/nbaStats': { nbaStatValue },
      './services/renderSnapshots': {}, './services/foregroundRefresh': {},
    });
    const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
    const render = () => { stateIndex = 0; refIndex = 0; return walk(api.default({ renderNFL: report => jsx('full-nfl-breakdown', { report }) })); };
    let nodes = render();
    nodes.find(node => node.props?.['aria-controls'] === 'gamewire-bot-panel').props.onClick();
    async function choose(name) {
      nodes = render();
      nodes.find(node => node.type === 'input').props.onChange({ target: { value: name } });
      nodes = render();
      nodes.find(node => node.props?.className === 'gwb-search-results').props.children[0][0].props.onClick();
      await new Promise(setImmediate); nodes = render();
    }
    await choose('Josh Allen');
    assert.ok(nodes.some(node => node.type === 'full-nfl-breakdown'), 'NFL breakdown renders directly, not inside disclosure');
    nodes.find(node => node.type === 'select').props.onChange({ target: { value: 'half' } });
    await new Promise(setImmediate); nodes = render();
    assert.equal(calls.at(-1)[2], 'half');
    nodes.find(node => node.props?.['aria-pressed'] === false).props.onClick();
    await choose('LeBron James');
    assert.deepEqual(calls.map(call => call[0]), ['NFL', 'NFL', 'NBA']);
    assert.ok(nodes.some(node => node.type === 'full-nfl-breakdown'));
    assert.ok(nodes.some(node => node.type === api.NBAPlayerCard));
    assert.equal(nodes.filter(node => node.type === 'input').length, 1);
    assert.ok(!nodes.some(node => ['textarea', 'details'].includes(node.type) || node.props?.role === 'tab'));
    const emptyCard = JSON.stringify(api.NBAPlayerCard({ report, onClear() {} }));
    assert.match(emptyCard, /Saved matchup projections/);
    assert.match(emptyCard, /No supported saved projection/);
    assert.match(emptyCard, /Source offline/);
    assert.match(emptyCard, /Recorded recent games/);
    for (const label of ['PTS', 'REB', 'AST', 'PRA', '3PM']) assert.ok(emptyCard.includes(label));
    const populated = JSON.stringify(api.NBAPlayerCard({ report: { ...report, projection: athlete('1', '1', 40) }, onClear() {} }));
    assert.match(populated, /40.0/);
    assert.match(populated, /No saved estimate/, 'Absent threes stay unavailable');
    assert.match(readFileSync(new URL('../src/GamewireBot.tsx', import.meta.url), 'utf8'), /return <PlayerLabCards/);
});
