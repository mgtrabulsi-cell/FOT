import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { botLogRows } from '../supabase/functions/_shared/gamewireBot.ts';
function load(path, imports) {
  const context = vm.createContext({ exports: {}, console, Date, AbortSignal, require(name) {
    if (name in imports) return imports[name];
    throw Error(`Unexpected dependency ${name}`);
  } });
  vm.runInContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}
const research = load('../src/services/playerLabResearch.ts', {
  './gamewireBot': {}, './nbaData': {}, './nbaStats': {}, './renderSnapshots': {}, './teamGameLogs': {}, './sportsData': {},
  '../../supabase/functions/_shared/gamewireBot': {}, './sportsDatabase': {},
});
test('Natural language thresholds do not confuse the game window or 3PM with a stat line', () => {
  const request = research.hitRequest('T Higgins receiving yard hit rates last 10 games at 50, 75, 100');
  assert.equal(request.games, 10);
  assert.equal(request.metric, 'receivingYards');
  assert.deepEqual([...request.levels], [50, 75, 100]);
  assert.equal(request.comparison, 'at least');
  const nba = research.hitRequest('Curry 3PM hit rate last 5 games over 3.5');
  assert.equal(nba.metric, 'threePointersMade');
  assert.deepEqual([...nba.levels], [3.5]);
  assert.equal(nba.comparison, 'over');
  assert.throws(() => research.hitRequest('Higgins receiving yards hit rate last 20 games'), /5 to 10/);
  assert.throws(() => research.hitRequest('Higgins hit rates last 10 games'), /Specify/);
});
test('Exact hit counts retain zeroes, exclude unknowns and future games, deduplicate, and use only the requested window', () => {
  const request = research.hitRequest('Higgins receiving yards hit rates last 5 games at 50, 75, 100');
  const values = [100, 75, undefined, 50, 0, 999];
  const games = values.map((value, index) => ({ id: String(index), date: `2026-11-${String(20 - index).padStart(2, '0')}T00:00:00Z`, value }));
  const report = research.buildHitReport('Higgins', request, [...games, games[0], { id: 'future', date: '2099-01-01', value: 999 }], [], Date.parse('2026-11-21'));
  assert.equal(report.games.length, 5);
  assert.deepEqual(Array.from(report.rows, row => [row.level, row.hits, row.sample, row.percent]), [[50, 3, 4, 75], [75, 2, 4, 50], [100, 1, 4, 25]]);
  assert.match(report.issues.join(' '), /unavailable/);
  const strict = research.buildHitReport('Higgins', { ...request, comparison: 'over' }, games, [], Date.parse('2026-11-21'));
  assert.equal(strict.rows[0].hits, 2);
  const empty = research.buildHitReport('Higgins', request, []);
  assert.equal(empty.rows[0].percent, null);
});
test('Three-player NBA recommendation follows saved matchup PRA, never season averages, and refuses incomplete comparisons', async () => {
  const chat = load('../src/services/playerLabChat.ts', {
    './gamewireBot': {}, './nbaPlayerLab': {}, './nbaStats': {}, './sportsData': {}, './playerLabResearch': research,
  });
  const answers = [31, 45, 20].map((mean, index) => ({ nba: {
    player: { name: `Player ${index}` }, game: { status: 'UPCOMING', date: new Date(Date.now() + 3600000).toISOString() }, forecastAt: new Date(Date.now() - 1000).toISOString(),
    projection: { status: 'Active', matchup: 'Verified opponent matchup', stats: {
      pra: { mean }, points: { mean: mean - 10 }, rebounds: { mean: 6 }, assists: { mean: 4 },
    } },
  } }));
  const text = await chat.startOpinion(answers, 'ppr', new AbortController().signal);
  assert.match(text.join(' '), /start Player 1 first/);
  assert.match(text.join(' '), /45\.0 projected PRA/);
  answers[2].nba.projection = null;
  const incomplete = await chat.startOpinion(answers, 'ppr', new AbortController().signal);
  assert.match(incomplete.join(' '), /Cannot fairly rank/);
  assert.doesNotMatch(incomplete.join(' '), /start Player \d first/);
});
test('Team name matching does not confuse Hornets with Nets and reads actual final scores', async () => {
  const teams = [{ id: '1', name: 'Charlotte Hornets', abbr: 'CHA', score: 111 }, { id: '2', name: 'Brooklyn Nets', abbr: 'BKN', score: 99 }];
  const api = load('../src/services/playerLabResearch.ts', {
    './gamewireBot': {}, './nbaData': {}, './nbaStats': {}, './renderSnapshots': {}, './sportsData': {},
    '../../supabase/functions/_shared/gamewireBot': {}, './sportsDatabase': {},
    './teamGameLogs': { fetchTeamLogDirectory: async () => ({ season: 2027, teams }),
      fetchTeamGameLog: async () => [{ seasonType: 2, game: { eventId: '900', date: '2026-01-01', home: teams[0], away: teams[1] } }] },
  });
  const report = await api.teamHitReport('NBA Hornets points hit rate last 5 games at 100, 120', new AbortController().signal);
  assert.equal(report.name, 'Charlotte Hornets (NBA)');
  assert.equal(report.rows[0].hits, 1);
  assert.equal(report.rows[1].hits, 0);
  assert.equal(report.games[0].value, 111);
});
test('NFL multi-player opinion ranks verified simulation scoring, preserving the selected format and refusing missing touchdown evidence', async () => {
  const date = new Date(Date.now() + 3600000).toISOString(), checked = new Date(Date.now() - 1000).toISOString();
  const games = [0, 1, 2].map(id => ({ eventId: String(id), status: 'UPCOMING', date }));
  const players = [0, 1, 2].map(id => ({ id: String(id), name: `Receiver ${id}`, status: 'Active', games: 10, issue: null,
    stats: { receivingYards: { mean: 50 + id * 20 }, receivingTouchdowns: { mean: .5 }, receptions: { mean: 3 + id } } }));
  const reports = players.map(player => ({ nfl: { player: { ...player, teamId: 'T', position: 'WR' }, week: 10, eligibleForGuidance: true,
    projections: [], matchup: { eventId: player.id }, matchupText: 'Verified upcoming opponent' } }));
  const chat = load('../src/services/playerLabChat.ts', {
    './gamewireBot': { readSavedGameSimulation: async game => ({ status: 'ready', forecastAt: checked,
      scenarios: [{ id: 'one', home: { id: 'T', players: [players[Number(game.eventId)]] } }] }) },
    './nbaPlayerLab': {}, './nbaStats': {}, './sportsData': { fetchScoreboards: async () => ({ games }) }, './playerLabResearch': research,
  });
  const text = await chat.startOpinion(reports, 'ppr', new AbortController().signal);
  assert.match(text.join(' '), /start Receiver 2 first/);
  assert.match(text.join(' '), /17\.0 projected points before turnovers/);
  const standard = await chat.startOpinion(reports, 'standard', new AbortController().signal);
  assert.match(standard.join(' '), /12\.0 projected points before turnovers/);
  delete players[1].stats.receivingTouchdowns;
  const incomplete = await chat.startOpinion(reports, 'ppr', new AbortController().signal);
  assert.match(incomplete.join(' '), /Cannot fairly rank/);
  assert.doesNotMatch(incomplete.join(' '), /start Receiver \d first/);
});
test('Primary Player Lab is one unified chat with direct NFL/NBA cards and no research launcher', () => {
  const entry = readFileSync(new URL('../src/GamewireBot.tsx', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../src/PlayerLabChat.tsx', import.meta.url), 'utf8');
  const cards = readFileSync(new URL('../src/PlayerLabCards.tsx', import.meta.url), 'utf8');
  assert.match(entry, /return <PlayerLabChat initiallyOpen/);
  assert.doesNotMatch(entry, /return <PlayerLabCards/);
  assert.match(chat, /NBAPlayerCard report=/);
  assert.match(chat, /message\.answer\?\.nfl && renderNFL/);
  assert.doesNotMatch(cards, /Ask GamewAIre|gwb-research-chat|import PlayerLabChat/);
});
test('NFL fallback uses the full verified game log, not the subset of games with archived forecasts', async () => {
  const payload = { names: ['receivingYards'], events: {
    '1': { gameDate: '2026-01-03', opponent: { id: '2' } },
    '2': { gameDate: '2026-01-02', opponent: { id: '2' } },
    '3': { gameDate: '2026-01-01', opponent: { id: '2' } },
  }, seasonTypes: [{ type: 2, displayName: '2026 Regular Season', categories: [{ events: [
    { eventId: '1', stats: ['100'] }, { eventId: '2', stats: ['50'] }, { eventId: '3', stats: ['0'] },
  ] }] }] };
  const api = load('../src/services/playerLabResearch.ts', {
    './gamewireBot': { readDirectorySnapshot: () => ({ season: 2026 }) },
    '../../supabase/functions/_shared/gamewireBot': { botLogRows },
    './nbaData': {}, './nbaStats': {}, './teamGameLogs': {}, './sportsData': {},
    './renderSnapshots': { restoreStatSnapshots: async () => {}, readRenderSnapshot: () => null },
    './sportsDatabase': { fetchStaticSports: async url => { assert.match(url, /athletes\/123\/gamelog\?season=2026/); return { ok: true, json: async () => payload }; } },
  });
  const report = await api.playerHitReport({ sport: 'NFL', player: { id: '123', teamId: '1', name: 'Tee Higgins' } },
    'T Higgins receiving yards hit rates last 5 games at 50, 100', new AbortController().signal);
  assert.equal(report.rows[0].hits, 2);
  assert.equal(report.rows[0].sample, 3);
  assert.equal(report.rows[1].hits, 1);
});
