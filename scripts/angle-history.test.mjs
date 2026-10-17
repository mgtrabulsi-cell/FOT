import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMatchupHistorySuggestions, historyWindow, matchupHistorySuggestions, readHistoryYear } from '../src/services/angleHistory.ts';

const game = {
  id: 'NFL:999', eventId: '999', feedPath: 'football/nfl', league: 'NFL', seasonYear: 2026,
  date: '2026-10-18T17:00:00Z', neutralSite: false,
  home: { id: '1', name: 'Home Team', abbr: 'HOM' }, away: { id: '2', name: 'Away Team', abbr: 'AWY' },
};
const meeting = (id, changes = {}) => ({
  id: String(id), date: `2026-09-${String(28 - id).padStart(2, '0')}T17:00:00Z`,
  homeId: '1', awayId: '2', homeScore: 21, awayScore: 7, neutralSite: false, ...changes,
});
const leads = (rows, matchup = game) => matchupHistorySuggestions(matchup, rows, Date.parse(matchup.date)).suggestions;
const rate = (rows, matchup) => leads(rows, matchup).filter((lead) => lead.key.endsWith(':win-rate'));
const streak = (rows, suffix = ':unbeaten', matchup) => leads(rows, matchup).filter((lead) => lead.key.endsWith(suffix));
const rawEvent = (row, type = 2) => ({
  id: row.id, date: row.date, season: { year: Number(row.date.slice(0, 4)), type },
  competitions: [{
    neutralSite: row.neutralSite,
    status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    competitors: [
      { id: row.homeId, team: { id: row.homeId }, homeAway: 'home', score: { value: row.homeScore } },
      { id: row.awayId, team: { id: row.awayId }, homeAway: 'away', score: { displayValue: String(row.awayScore) } },
    ],
  }],
});

test('win rate requires at least four meetings and strictly over 70%, with ties in the denominator', () => {
  assert.equal(rate([1, 2, 3].map((id) => meeting(id))).length, 0);
  const ten = Array.from({ length: 10 }, (_, i) => meeting(i + 1, { homeScore: i < 7 ? 21 : 3 }));
  assert.equal(rate(ten).length, 0, 'exactly 70% is not above 70%');
  const qualifying = rate([meeting(1), meeting(2), meeting(3), meeting(4, { homeScore: 7 })]);
  assert.equal(qualifying.length, 1);
  assert.match(qualifying[0].article.headline, /75%/);
  assert.match(qualifying[0].history.evidence, /3-0-1 W-L-T/);
  assert.equal(qualifying[0].subject, 'Home Team');
  assert.equal(qualifying[0].category, 'Head-to-head history');
  assert.equal(qualifying[0].history.meetings.length, 4);
  assert.ok(qualifying[0].history.meetings.every((item) => /^https:\/\/www\.espn\.com\/nfl\/game\/_\/gameId\/\d+$/.test(item.url)));
  assert.equal(rate([meeting(1), meeting(2), meeting(3, { homeScore: 7 }), meeting(4, { homeScore: 7 })]).length, 0);
});

test('records work from either side and sort chronologically, ignoring response order', () => {
  const rows = [1, 2, 3, 4].map((id) => meeting(id, { homeScore: 0 }));
  const lead = rate(rows.reverse())[0];
  assert.equal(lead.subject, 'Away Team');
  assert.match(lead.article.headline, /100% wins vs HOM/);
  assert.match(lead.history.meetings[0].label, /2026-09-27/);
  const reversed = rows.map((row) => ({ ...row, homeId: '2', awayId: '1', homeScore: 21, awayScore: 0 }));
  assert.equal(rate(reversed)[0].subject, 'Away Team');
});

test('unbeaten means latest four meetings, not any four wins, and never implies ties are wins', () => {
  const rows = [1, 2, 3, 4, 5].map((id) => meeting(id));
  assert.equal(streak(rows).length, 1);
  assert.equal(streak([meeting(0, { homeScore: 0 }), ...rows]).length, 0);
  const ties = [1, 2, 3, 4].map((id) => meeting(id, { homeScore: 7 }));
  assert.equal(streak(ties).length, 2);
  assert.match(streak(ties)[0].article.description, /0-0-4 W-L-T/);
  assert.match(streak(ties)[0].article.description, /not necessarily a four-game winning streak/);
});

test('home/away trends use the upcoming configuration, exclude neutral games, and do not skip unknown venue losses', () => {
  const rows = [1, 2, 3, 4].map((id) => meeting(id));
  const oppositeVenueLoss = meeting(0, { homeId: '2', awayId: '1', homeScore: 21, awayScore: 0 });
  const home = streak([oppositeVenueLoss, ...rows], ':venue-unbeaten');
  assert.equal(home.length, 1);
  assert.match(home[0].article.headline, /four home meetings/);
  const away = streak(rows.map((row) => ({ ...row, homeScore: 0 })), ':venue-unbeaten');
  assert.match(away[0].article.headline, /four away meetings/);
  assert.equal(streak(rows, ':venue-unbeaten', { ...game, home: game.away, away: game.home }).length, 0);
  assert.equal(streak(rows.map((row) => ({ ...row, neutralSite: true })), ':venue-unbeaten').length, 0);
  assert.equal(rate(rows.map((row) => ({ ...row, neutralSite: true }))).length, 1);
  assert.equal(streak(rows, ':venue-unbeaten', { ...game, neutralSite: true }).length, 0);
  const unknown = matchupHistorySuggestions(game, [...rows, meeting(0, { neutralSite: null, homeScore: 0 })], Date.parse(game.date));
  assert.equal(unknown.suggestions.filter((lead) => lead.key.endsWith(':venue-unbeaten')).length, 0);
  assert.match(unknown.errors[0], /neutral-site information is missing/);
  assert.equal(matchupHistorySuggestions({ ...game, neutralSite: undefined }, rows).errors.length, 1);
});

test('five-year window excludes kickoff, future games, wrong opponents, and duplicate games', () => {
  const { start, end } = historyWindow(game.date);
  const rows = [1, 2, 3].map((id) => meeting(id));
  const boundary = meeting(4, { date: new Date(start).toISOString() });
  assert.equal(rate([...rows, boundary]).length, 1);
  assert.equal(rate([...rows, { ...boundary, date: new Date(start - 1).toISOString() }]).length, 0);
  assert.equal(rate([...rows, { ...boundary, date: game.date }]).length, 0);
  assert.equal(rate([...rows, { ...boundary, id: game.eventId }]).length, 0);
  assert.equal(rate([...rows, { ...boundary, awayId: '3' }]).length, 0);
  assert.equal(rate([...rows, rows[0]]).length, 0);
  assert.equal(matchupHistorySuggestions(game, [...rows, boundary], start - 1).suggestions.length, 0);
  assert.equal(new Date(historyWindow('2028-02-29T17:00:00Z').start).toISOString(), '2023-02-28T17:00:00.000Z');
  assert.equal(end, Date.parse(game.date));
  assert.throws(() => historyWindow('bad'), /valid kickoff/);
  assert.throws(() => leads([...rows, { ...rows[0], homeScore: 0 }]), /Conflicting/);
});

test('history parsing includes playoff finals, excludes preseason/live/cancelled games, and preserves true zero scores', () => {
  const regular = rawEvent(meeting(1, { homeScore: 0 }));
  const playoff = rawEvent(meeting(2), 3);
  const live = rawEvent(meeting(3));
  live.competitions[0].status.type = { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
  const cancelled = rawEvent(meeting(4));
  cancelled.competitions[0].status.type.name = 'STATUS_CANCELED';
  const parsed = readHistoryYear({ events: [regular, playoff, rawEvent(meeting(5), 1), live, cancelled] }, 2026);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].homeScore, 0);
  assert.equal(parsed[1].id, '2');
  const newYearNight = rawEvent(meeting(7, { date: '2027-01-01T01:15:00Z' }));
  assert.equal(readHistoryYear({ events: [newYearNight] }, 2026).length, 1, 'ESPN indexes the Dec 31 night game by Eastern calendar year');
  assert.throws(() => readHistoryYear({ events: [newYearNight] }, 2027), /wrong-year/);
  const missingVenue = rawEvent(meeting(6));
  delete missingVenue.competitions[0].neutralSite;
  assert.equal(readHistoryYear({ events: [missingVenue] }, 2026)[0].neutralSite, null);
});

test('malformed history is an explicit failure, never a zero-score or empty-history fallback', () => {
  for (const value of [{}, { events: [] }, { events: Array(1000).fill({}) }]) assert.throws(() => readHistoryYear(value, 2026), /missing|truncated/);
  const event = rawEvent(meeting(1));
  assert.throws(() => readHistoryYear({ events: [event] }, 2025), /wrong-year/);
  for (const value of ['', null, {}, { value: null }, { value: -1 }, { value: 2.5 }]) {
    const changed = structuredClone(event);
    changed.competitions[0].competitors[0].score = value;
    assert.throws(() => readHistoryYear({ events: [changed] }, 2026), /invalid final score/);
  }
  const unknownType = { ...event, season: { type: 4 } };
  assert.throws(() => readHistoryYear({ events: [unknownType] }, 2026), /unknown season type/);
  const missingStatus = structuredClone(event);
  delete missingStatus.competitions[0].status;
  assert.throws(() => readHistoryYear({ events: [missingStatus] }, 2026), /completion status/);
});

test('fetching shares calendar years, caches valid results, suppresses failed-year trends, and retries failures', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let failure = true;
  let active = 0;
  let peak = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.cache, 'no-store');
    const year = Number(new URL(url).searchParams.get('dates'));
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (year === 2003 && failure) return { ok: false, status: 503 };
    const events = year === 2006 ? [1, 2, 3, 4].map((id) => rawEvent(meeting(id, { date: `2006-09-${10 + id}T17:00:00Z` })))
      : [rawEvent(meeting(year, { date: `${year}-09-01T17:00:00Z`, homeId: '3', awayId: '4' }))];
    return { ok: true, json: async () => ({ events }) };
  };
  try {
    const matchup = { ...game, date: '2006-10-18T17:00:00Z' };
    const signal = new AbortController().signal;
    const failed = await fetchMatchupHistorySuggestions([matchup, { ...matchup, id: 'NFL:998', eventId: '998' }], signal);
    assert.equal(calls, 6);
    assert.ok(peak <= 3);
    assert.equal(failed.suggestions.length, 0);
    assert.match(failed.errors[0], /2003.*503/);
    assert.match(failed.errors[0], /partial history/);
    failure = false;
    const retried = await fetchMatchupHistorySuggestions([matchup], signal);
    assert.equal(calls, 7, 'only the failed year is fetched again');
    assert.equal(retried.errors.length, 0);
    assert.equal(retried.suggestions.length, 3);
    await fetchMatchupHistorySuggestions([{ ...matchup, date: '2007-01-01T01:00:00Z' }], signal);
    assert.equal(calls, 7, 'Eastern calendar-year requests cover UTC New Year night without losing Dec 31 games');
    const aborted = new AbortController();
    aborted.abort();
    assert.deepEqual(await fetchMatchupHistorySuggestions([matchup], aborted.signal), { suggestions: [], errors: [] });
  } finally { globalThis.fetch = original; }
});
