import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fetchTeamComparisonRanks, rankTeamAverages, teamComparisonMetrics } from '../src/services/teamComparisonRanks.ts';

const teams = Array.from({ length: 32 }, (_, index) => ({
  teamId: String(index + 1),
  ...Object.fromEntries(teamComparisonMetrics.map(({ key }) => [key, index + 1])),
}));

test('All eight NFL season metrics rank offense descending and defense ascending', () => {
  const ranks = rankTeamAverages(teams, 2026);
  assert.equal(ranks.season, 2026);
  for (const { key, defense } of teamComparisonMetrics) {
    assert.equal(ranks.teams[0].ranks[key].rank, defense ? 1 : 32);
    assert.equal(ranks.teams[31].ranks[key].rank, defense ? 32 : 1);
  }
});

test('Ties use competition ranks; zero is valid, missing metric suppresses its whole league rank', () => {
  const changed = teams.map((team) => ({ ...team }));
  changed[30].pointsPerGame = 32;
  changed[0].pointsAllowedPerGame = 0;
  changed[10].rushingYardsPerGame = null;
  const ranks = rankTeamAverages(changed, 2026);
  assert.deepEqual(ranks.teams[31].ranks.pointsPerGame, { rank: 1, tied: true });
  assert.equal(ranks.teams[29].ranks.pointsPerGame.rank, 3);
  assert.equal(ranks.teams[0].ranks.pointsAllowedPerGame.rank, 1);
  assert.equal(ranks.teams.every((team) => team.ranks.rushingYardsPerGame === null), true);
  assert.notEqual(ranks.teams[0].ranks.passingYardsPerGame, null);
  assert.throws(() => rankTeamAverages(teams.slice(1), 2026), /all 32/);
  assert.throws(() => rankTeamAverages([...teams.slice(1), teams[1]], 2026), /all 32/);
});

test('League ranks share one bounded fetch, use the selected season and retry failures', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = async (address, init) => {
    calls++;
    const url = new URL(address);
    if (url.pathname.endsWith('/teams')) return Response.json({ sports: [{ leagues: [{ teams: teams.map((team) => ({ team: { id: team.teamId } })) }] }] });
    assert.equal(url.searchParams.get('season'), '2199');
    assert.equal(url.searchParams.get('seasontype'), '2');
    assert.equal(init.cache, 'reload');
    if (fail) return new Response('', { status: 503 });
    const id = url.pathname.match(/teams\/(\d+)/)[1];
    const stat = (name) => ({ name, value: Number(id) });
    const categories = [
      { name: 'scoring', stats: [stat('totalPointsPerGame')] },
      { name: 'passing', stats: [stat('yardsPerGame'), stat('passingYardsPerGame')] },
      { name: 'rushing', stats: [stat('rushingYardsPerGame')] },
    ];
    return Response.json({ results: { stats: { categories }, opponent: categories } });
  };
  try {
    fail = true;
    await assert.rejects(fetchTeamComparisonRanks('football/test', 2199), /HTTP 503/);
    fail = false; calls = 0;
    const [first, second] = await Promise.all([
      fetchTeamComparisonRanks('football/test', 2199), fetchTeamComparisonRanks('football/test', 2199),
    ]);
    assert.equal(first, second);
    assert.equal(calls, 33);
    assert.equal(first.teams[0].ranks.pointsPerGame.rank, 32);
    await fetchTeamComparisonRanks('football/test', 2199);
    assert.equal(calls, 33);
  } finally { globalThis.fetch = original; }
});

test('A transient team failure retries only that team and league requests stay bounded', async () => {
  const original = globalThis.fetch;
  const attempts = new Map();
  let active = 0;
  let maximumActive = 0;
  globalThis.fetch = async (address, init) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/teams')) return Response.json({ sports: [{ leagues: [{ teams: teams.map((team) => ({ team: { id: team.teamId } })) }] }] });
    assert.equal(init.cache, 'reload');
    const id = url.pathname.match(/teams\/(\d+)/)[1];
    attempts.set(id, (attempts.get(id) ?? 0) + 1);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (id === '7' && attempts.get(id) === 1) return new Response('', { status: 503 });
    const stat = (name) => ({ name, value: Number(id) });
    const categories = [
      { name: 'scoring', stats: [stat('totalPointsPerGame')] },
      { name: 'passing', stats: [stat('yardsPerGame'), stat('passingYardsPerGame')] },
      { name: 'rushing', stats: [stat('rushingYardsPerGame')] },
    ];
    return Response.json({ results: { stats: { categories }, opponent: categories } });
  };
  try {
    const result = await fetchTeamComparisonRanks('football/retry-test', 2199);
    assert.equal(result.teams.length, 32);
    assert.equal(attempts.get('7'), 2);
    assert.equal([...attempts.values()].reduce((sum, count) => sum + count, 0), 33);
    assert.equal(maximumActive, 4);
    assert.ok(result.teams.every((team) => teamComparisonMetrics.every(({ key }) => team.ranks[key] !== null)));
  } finally { globalThis.fetch = original; }
});

test('Incomplete ESPN statistics are not cached as a successful ten-minute league load', async () => {
  const original = globalThis.fetch;
  let incomplete = true;
  let lists = 0;
  globalThis.fetch = async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/teams')) {
      lists++;
      return Response.json({ sports: [{ leagues: [{ teams: teams.map((team) => ({ team: { id: team.teamId } })) }] }] });
    }
    const id = url.pathname.match(/teams\/(\d+)/)[1];
    const stat = (name) => ({ name, value: Number(id) });
    const categories = [
      { name: 'scoring', stats: incomplete && id === '7' ? [] : [stat('totalPointsPerGame')] },
      { name: 'passing', stats: [stat('yardsPerGame'), stat('passingYardsPerGame')] },
      { name: 'rushing', stats: [stat('rushingYardsPerGame')] },
    ];
    return Response.json({ results: { stats: { categories }, opponent: categories } });
  };
  try {
    const first = await fetchTeamComparisonRanks('football/incomplete-test', 2199);
    assert.equal(first.teams.every((team) => team.ranks.pointsPerGame === null), true);
    assert.notEqual(first.teams[0].ranks.passingYardsPerGame, null);
    incomplete = false;
    const updated = await fetchTeamComparisonRanks('football/incomplete-test', 2199);
    assert.equal(lists, 2);
    assert.ok(updated.teams.every((team) => teamComparisonMetrics.every(({ key }) => team.ranks[key] !== null)));
    await fetchTeamComparisonRanks('football/incomplete-test', 2199);
    assert.equal(lists, 2);
  } finally { globalThis.fetch = original; }
});

test('Rank loading preloads on matchup opening and does not restart on comparison tab switches', () => {
  const source = readFileSync(new URL('../src/TheWire.tsx', import.meta.url), 'utf8');
  const effect = source.slice(source.lastIndexOf('useEffect(() => {', source.indexOf('void fetchTeamComparisonRanks')),
    source.indexOf('ranksRetry]);') + 'ranksRetry]);'.length);
  assert.match(effect, /if \(!detailOpen \|\| !isUpcoming \|\| !feedPath \|\| !seasonYear\) return/);
  assert.doesNotMatch(effect, /subTab/);
  assert.match(effect, /setRanksError\('Some NFL ranks are unavailable/);
  assert.match(effect, /if \(!active\) return/);
});
