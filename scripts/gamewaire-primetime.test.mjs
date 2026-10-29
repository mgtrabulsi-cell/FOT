import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, defaultSettings, isNFLPrimetime, pickBlurb, rankTopPicks } from '../supabase/functions/_shared/gamewaire.ts';
import { collectEvidence, nflOpponentYardage, teamSituationalForm } from '../supabase/functions/_shared/gamewaireSources.ts';

const now = Date.parse('2026-10-29T13:00:00Z');
const start = '2026-10-30T00:15:00Z';
const quotes = Array.from({ length: 10 }, (_, i) => ({ key: `player-${i}`, eventId: 'nfl', sport: 'NFL', start,
  home: 'Home', away: 'Away', market: 'player_reception_yds', subject: `Player ${i}`, side: 'Over', line: 40.5,
  american: -110, noVig: 0.5, book: 'Book', updatedAt: new Date(now).toISOString() }));
const evidence = new Map(quotes.map((q) => [q.key, { eligible: true, quality: 0.8, fetchedAt: new Date(now).toISOString(), risks: [],
  samples: Array.from({ length: 8 }, (_, i) => ({ value: i < 4 ? 60 : 20, date: new Date(now - (4 + i * 7) * 86400000).toISOString() })) }]));
test('Primetime detection uses Eastern weekday and 7 PM cutoff across DST, not UTC date', () => {
  for (const date of [start, '2026-11-02T01:20:00Z', '2026-11-03T01:20:00Z', '2026-12-04T00:00:00Z']) assert.equal(isNFLPrimetime(date), true, date);
  for (const date of ['2026-11-01T18:00:00Z', '2026-11-01T23:59:00Z', '2026-10-31T00:15:00Z', 'invalid']) assert.equal(isNFLPrimetime(date), false, date);
});
test('Primetime pool supplies eight distinct verified props plus a team lean, with private Stretch labels', () => {
  const team = { ...quotes[0], key: 'team', subject: 'Home', side: 'Home', market: 'h2h', line: null };
  const data = new Map([...evidence, [team.key, evidence.get(quotes[0].key)]]);
  const result = evaluate([...quotes, team], data, { ...defaultSettings, markets: ['player_reception_yds'], minEdge: 1 }, now, 9, 8);
  assert.equal(result.picks.filter((q) => q.market.startsWith('player_')).length, 8);
  assert.equal(new Set(result.picks.filter((q) => q.market.startsWith('player_')).map((q) => q.subject)).size, 8);
  assert.equal(result.picks.length, 9);
  assert.equal(result.stretchKeys.length, 9);
  assert.ok(result.picks.every((q) => !('stretch' in q)));
  const limited = evaluate(quotes.slice(0, 5), evidence, { ...defaultSettings, markets: ['player_reception_yds'] }, now, 9, 8);
  assert.equal(limited.picks.length, 5);
  const unsafe = new Map([...data].map(([key, row]) => [key, { ...row, eligible: false }]));
  assert.equal(evaluate([...quotes, team], unsafe, defaultSettings, now, 9, 8).picks.length, 0);
});
test('Defensive yardage parser reads opponent statistics only and rejects wrong season/team and incomplete metrics', () => {
  const body = { team: { id: '1' }, season: { year: 2026, type: 2 }, results: {
    stats: { categories: [{ stats: [{ name: 'receivingYardsPerGame', value: 999 }] }] },
    opponent: [{ stats: [{ name: 'receivingYardsPerGame', value: 270 }, { name: 'netPassingYardsPerGame', value: 250 }, { name: 'rushingYardsPerGame', value: 110 }] }],
  } };
  assert.deepEqual(nflOpponentYardage(body, '1', 2026), { receiving: 270, passing: 250, rushing: 110 });
  assert.throws(() => nflOpponentYardage(body, '2', 2026), /different team/);
  assert.throws(() => nflOpponentYardage(body, '1', 2025), /different team/);
  assert.throws(() => nflOpponentYardage(body, '1', 2026, 7), /game count/);
  assert.throws(() => nflOpponentYardage({ ...body, results: {} }, '1', 2026), /unavailable/);
});
test('NBA and NFL prop odds stop at -200 for normal and Stretch candidates without restricting team leans', () => {
  for (const sport of ['NBA', 'NFL']) for (const minEdge of [0, 1]) {
    const prices = [-400, -210, -201, -200, -199, -110, 100, 210];
    const pool = prices.map((american, i) => ({ ...quotes[0], sport, american, key: `price-${i}`, subject: `Player ${i}` }));
    const team = { ...pool[0], key: 'team', subject: 'Home', side: 'Home', market: 'h2h', line: null };
    const data = new Map([...pool, team].map((q) => [q.key, { eligible: true, quality: 1, fetchedAt: new Date(now).toISOString(), risks: [],
      samples: Array.from({ length: 12 }, (_, i) => ({ value: 80, date: new Date(now - (1 + i) * 86400000).toISOString() })) }]));
    const result = evaluate([...pool, team], data, { ...defaultSettings, markets: ['player_reception_yds'], minEdge, minEV: 0 }, now, 9, 8);
    const props = result.picks.filter((q) => q.market.startsWith('player_'));
    assert.deepEqual(props.map((q) => q.american).sort((a, b) => a - b), prices.slice(3));
    assert.equal(result.rejected.filter((q) => /-200 or better/.test(q.reason)).length, 3);
    assert.equal(result.teamLean.pick.american, -400);
    if (minEdge === 1) assert.ok(props.every((q) => result.stretchKeys.includes(q.key)));
    const duplicate = evaluate([...pool, { ...pool[3], american: -250, book: 'Worse book' }], data,
      { ...defaultSettings, markets: ['player_reception_yds'], minEdge: 1 }, now, 9, 8);
    assert.equal(duplicate.picks.find((q) => q.key === pool[3].key).american, -200);
  }
});
test('Situational records use real consecutive games within each season, not ATS or cross-season transitions', () => {
  const form = teamSituationalForm([
    { date: '2025-12-29T01:20:00Z', season: 2025, value: -7 },
    { date: '2026-09-10T23:15:00Z', season: 2026, value: 10 },
    { date: '2026-09-18T00:15:00Z', season: 2026, value: -4 },
    { date: '2026-09-28T00:20:00Z', season: 2026, value: 3 },
    { date: '2026-10-05T00:20:00Z', season: 2026, value: 0 },
  ], 2026);
  assert.deepEqual(form.afterLoss, { wins: 1, losses: 0, ties: 0 });
  assert.deepEqual(form.afterWin, { wins: 0, losses: 1, ties: 1 });
  assert.equal(form.latestResult, 'tie');
  assert.deepEqual(form.primetime, { wins: 2, losses: 2, ties: 1 });
});
test('Opponent yardage weakness breaks probability-band ties without changing probabilities or forcing a market', () => {
  const base = evaluate(quotes, evidence, { ...defaultSettings, markets: ['player_reception_yds'] }, now, 9, 8).picks[0];
  const opponent = { team: 'Away', pointsAllowed: 25, pointsScored: 22, games: 7, rank: 24, leagueSize: 32, season: 2026, fetchedAt: new Date(now).toISOString() };
  const weak = { ...base, key: 'z', opponents: [{ ...opponent, yardage: { receiving: { perGame: 280, rank: 30 } } }] };
  const strong = { ...base, key: 'a', opponents: [{ ...opponent, yardage: { receiving: { perGame: 180, rank: 3 } } }] };
  assert.equal(rankTopPicks([strong, weak])[0].key, 'z');
  assert.equal(rankTopPicks([{ ...strong, probability: base.probability + 0.02 }, weak])[0].key, 'a');
  assert.equal(rankTopPicks([{ ...strong, side: 'Under' }, { ...weak, side: 'Under' }])[0].key, 'a');
  assert.equal(weak.probability, base.probability);
  assert.match(pickBlurb(weak), /280\.0 receiving yards per game/);
  for (const side of ['Over', 'Under']) {
    const text = pickBlurb({ ...weak, side, line: 40.5 });
    assert.match(text, new RegExp(`selection is ${side.toLowerCase()} 40\\.5 receiving yards`));
    assert.match(text, /sportsbook lines vary/);
    assert.match(text, /displayed line and price, not unassessed alternatives/);
  }
});
test('Team blurbs summarize form, retain defense and verified situational records without margin lists or hedging boilerplate', () => {
  const base = evaluate(quotes, evidence, { ...defaultSettings, markets: ['player_reception_yds'] }, now, 9, 8).picks[0];
  const blurb = pickBlurb({ ...base, market: 'spreads', subject: 'Home', side: 'Home', line: 3.5,
    teamForm: { latestResult: 'loss', seasons: [2025, 2026], afterLoss: { wins: 5, losses: 2, ties: 0 }, afterWin: { wins: 1, losses: 3, ties: 0 }, primetime: { wins: 3, losses: 1, ties: 0 } },
    opponents: [{ team: 'Away', pointsAllowed: 25, pointsScored: 22, games: 7, rank: 24, leagueSize: 32 }] });
  assert.match(blurb, /5-2 following a loss/);
  assert.match(blurb, /3-1 in Thursday\/Sunday\/Monday night games/);
  assert.match(blurb, /straight up, not ATS/);
  assert.match(blurb, /rank 24 of 32/);
  assert.match(blurb, /GamewAIre's selection is Home \+3\.5/);
  assert.doesNotMatch(blurb, /outscored|lost by|won by|shift the outlook|guaranteed|ATS record/i);
});
test('Evidence computes defensive yardage ranks from all 32 verified opponents and omits ranks if any team fails', async () => {
  const teamQuote = { ...quotes[0], key: 'team', subject: 'Home', side: 'Home', market: 'h2h', line: null };
  const matchup = { eventId: 'nfl', season: 2026, home: { id: '1', name: 'Home' }, away: { id: '2', name: 'Away' } };
  for (const fail of [false, true]) {
    const fetcher = async (url) => {
      const parsed = new URL(url), year = Number(parsed.searchParams.get('season'));
      if (parsed.pathname.endsWith('/standings')) return Response.json({ season: { year: 2026 }, children: [{ standings: {
        entries: Array.from({ length: 32 }, (_, i) => ({ team: { id: String(i + 1), displayName: i === 0 ? 'Home' : i === 1 ? 'Away' : `Team ${i}` },
          stats: [{ name: 'wins', value: 4 }, { name: 'losses', value: 3 }, { name: 'pointsAgainst', value: 140 + i }, { name: 'pointsFor', value: 150 }] })),
      } }] });
      if (parsed.pathname.endsWith('/statistics')) {
        const id = parsed.pathname.split('/').at(-2);
        if (fail && id === '32') return new Response('unavailable', { status: 503 });
        return Response.json({ team: { id }, season: { year, type: 2 }, results: { opponent: [{ stats: [
          { name: 'teamGamesPlayed', value: 7 },
          { name: 'receivingYardsPerGame', value: 200 + Number(id) },
          { name: 'netPassingYardsPerGame', value: 190 + Number(id) },
          { name: 'rushingYardsPerGame', value: 90 + Number(id) },
        ] }] } });
      }
      if (parsed.pathname.endsWith('/schedule')) return Response.json({ events: Array.from({ length: 8 }, (_, i) => ({
        id: `${year}-${i}`, date: new Date(now - (year === 2026 ? 4 + i * 7 : 300 + i * 7) * 86400000).toISOString(),
        seasonType: { type: 2 }, competitions: [{ status: { type: { completed: true } }, competitors: [
          { team: { id: '1' }, score: 20 }, { team: { id: '2' }, score: 10 },
        ] }],
      })) });
      throw new Error('Unexpected public request');
    };
    const data = await collectEvidence([teamQuote], matchup, now, fetcher);
    const opponent = data.evidence.get('team').opponents[0];
    if (fail) {
      assert.equal(opponent.yardage, undefined);
      assert.ok(data.warnings.some((warning) => warning.includes('all 32 verified')));
    } else {
      assert.deepEqual(opponent.yardage.receiving, { perGame: 202, rank: 2 });
      assert.ok(data.evidence.get('team').teamForm);
    }
    assert.ok(data.warnings.some((warning) => warning.includes('ATS')));
  }
});
