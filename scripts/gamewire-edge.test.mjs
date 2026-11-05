import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { forecastDistribution, distributionAtLine } from '../supabase/functions/_shared/gamewireBotIntelligence.ts';
import { fairAmericanOdds, valueClassification, empiricalQuantile, modelVersion } from '../supabase/functions/_shared/gamewaire.ts';
import { rankWireTeams, wireAnalysisNotice } from '../src/services/wireTeamPicks.ts';
import { scoreboardBreakdown } from '../supabase/functions/_shared/gamewaireScoreboard.ts';

const now = Date.parse('2026-11-04T18:00:00Z');
const observations = Array.from({ length: 10 }, (_, index) => ({
  eventId: String(index), date: new Date(now - (index + 1) * 86400000).toISOString(), value: index, opportunity: 12,
}));
test('Empirical projections preserve count support, sample variance and normalized over/under/push mass', () => {
  const distribution = forecastDistribution(5, observations, true);
  assert.equal(distribution.calibrated, false);
  assert.equal(distribution.samples, 10);
  assert.ok(distribution.outcomes.every(value => Number.isInteger(value) && value >= 0));
  assert.ok(distribution.p25 <= distribution.median && distribution.median <= distribution.p75);
  const probabilities = distributionAtLine(distribution, 5);
  assert.ok(Math.abs(probabilities.over + probabilities.under + probabilities.push - 1) < 1e-12);
  assert.equal(distributionAtLine(distribution, 100).over, 0);
  assert.equal(distributionAtLine(distribution, 0).under, 0);
  assert.equal(forecastDistribution(5, observations.slice(0, 7), true), null);
  assert.equal(forecastDistribution(5, [...observations.slice(0, 7), ...observations.slice(0, 7)], true), null);
  assert.equal(forecastDistribution(null, observations, false), null);
  assert.throws(() => forecastDistribution(NaN, observations, false));
  assert.throws(() => distributionAtLine(distribution, NaN));
  const yardage = forecastDistribution(75, observations.map(row => ({ ...row, value: row.value * 10 })), false);
  assert.equal(yardage.expected, 75);
});
test('Value categories are determined from price edge, conservative EV and data quality, not raw hit probability', () => {
  const pick = { edge: .1, ev: .2, conservativeEV: .1, quality: .9 };
  assert.equal(valueClassification(pick), 'ELITE VALUE');
  assert.equal(valueClassification({ ...pick, quality: .8, conservativeEV: .04 }), 'A VALUE');
  assert.equal(valueClassification({ ...pick, quality: .75, edge: .03, conservativeEV: .001 }), 'B VALUE');
  assert.equal(valueClassification({ ...pick, conservativeEV: 0 }), 'WATCH');
  assert.equal(valueClassification({ ...pick, ev: -.01 }), 'WATCH');
  assert.equal(valueClassification({ ...pick, quality: .74 }), 'NO PLAY');
  assert.equal(valueClassification({ ...pick, edge: NaN }), 'NO PLAY');
  assert.equal(fairAmericanOdds(.75), -300);
  assert.equal(fairAmericanOdds(.25), 300);
  assert.equal(fairAmericanOdds(1), null);
  assert.equal(empiricalQuantile([0, 10, 20, 30], .5), 15);
});
const games = Array.from({ length: 4 }, (_, index) => ({
  id: `NBA:${index}`, eventId: String(index), league: 'NBA', status: 'UPCOMING',
  date: new Date(now + 3600000).toISOString(),
  away: { id: `a${index}`, name: `Away ${index}`, record: '1-4' },
  home: { id: `h${index}`, name: `Home ${index}`, record: '4-1' },
}));
const picks = games.map((game, index) => ({
  key: String(index), market: 'h2h', sport: 'NBA', subject: game.home.name, start: game.date, line: null,
  home: game.home.name, away: game.away.name, modelVersion, samples: [], risks: ['Role uncertainty.'], book: 'Saved book',
  identifiers: { espnEventId: game.eventId }, updatedAt: new Date(now - 60000).toISOString(), dataAt: new Date(now).toISOString(),
  american: -110, edge: .1, ev: .2, conservativeEV: .05 + index / 100, quality: .9, sampleSize: 20, noVig: .5,
}));
test('Missing upgraded analyses are pending information, not a misleading zero-of-total error or forced picks', () => {
  assert.match(wireAnalysisNotice({ analyzedGames: 0, pendingGames: 15, failedGames: 0 }, games), /analyzing 15 queued matchups/);
  assert.match(wireAnalysisNotice({ analyzedGames: 0, pendingGames: 0, failedGames: 0 }, games), /waiting for scheduled matchup analysis/);
  assert.equal(wireAnalysisNotice({ analyzedGames: 4, pendingGames: 0, failedGames: 0 }, games), '');
  const mixed = games.map((game, index) => ({ ...game, status: index === 0 ? 'FINAL' : 'UPCOMING' }));
  assert.equal(wireAnalysisNotice({ analyzedGames: 3, upcomingAnalyzedGames: 3, pendingGames: 0, failedGames: 0 }, mixed), '', 'Past games without v9 results do not leave a completed pregame refresh waiting forever');
  assert.match(wireAnalysisNotice({ analyzedGames: 3, upcomingAnalyzedGames: 2, pendingGames: 0, failedGames: 0 }, mixed), /waiting/);
  assert.equal(wireAnalysisNotice({ analyzedGames: 0, pendingGames: 0, failedGames: 1 }, games), '');
  assert.match(wireAnalysisNotice({ analyzedGames: 0, pendingGames: 0, failedGames: 0 }, games.map(game => ({ ...game, status: 'FINAL' }))), /not created retroactively/);
});
test('Scoreboards select at most three distinct qualifying games without record-based or Watch fillers', () => {
  const result = rankWireTeams(games, picks, now);
  assert.equal(Object.keys(result).length, 3);
  assert.equal(result['3:h3'].rank, 1);
  assert.ok(Object.values(result).every(row => row.label === 'GamewAIre Pick'));
  assert.match(result['3:h3'].reason, /Home 3 to win outright/);
  assert.doesNotMatch(result['3:h3'].reason, /Saved book|Role uncertainty|conservative expected value|uncalibrated|Saved pregame price/);
  const fallback = rankWireTeams(games, [], now);
  assert.equal(Object.keys(fallback).length, 0);
  for (const patch of [{ noVig: null }, { ev: -.1 }, { sampleSize: 3 }, { updatedAt: new Date(now - 600001).toISOString() },
    { dataAt: new Date(now + 60001).toISOString() }, { identifiers: { espnEventId: 'other' } }, { modelVersion: 'old-model' }]) {
    assert.equal(Object.keys(rankWireTeams(games, picks.map(pick => ({ ...pick, ...patch })), now)).length, 0);
  }
  assert.equal(Object.keys(rankWireTeams(games.slice(0, 2), picks, now)).length, 2);
  assert.equal(Object.keys(rankWireTeams(games.slice(0, 1), picks, now)).length, 1);
  for (const status of ['LIVE', 'FINAL']) assert.equal(Object.keys(rankWireTeams(games.map(game => ({ ...game, status })), picks, now + 86400000)).length, 3);
  assert.equal(Object.keys(rankWireTeams(games.map(game => ({ ...game, date: new Date(now + 86400000).toISOString() })), picks, now)).length, 0);
  assert.equal(Object.keys(rankWireTeams(games.map(game => ({ ...game, period: 'Postponed' })), picks, now)).length, 0);
  const opposite = { ...picks[3], subject: games[3].away.name, key: 'opposite', conservativeEV: .99 };
  const distinct = rankWireTeams(games, [...picks, opposite], now);
  assert.equal(Object.keys(distinct).length, 3);
  assert.equal(distinct['3:a3'].rank, 1);
  assert.equal(distinct['3:h3'], undefined);
});
test('Scoreboard breakdowns explain a few verified statistics in readable paragraphs, not boilerplate or odds tables', () => {
  const pick = { ...picks[0], sport: 'NFL', market: 'spreads', line: 3.5,
    teamContext: { team: 'Home 0', season: 2026, games: 8, pointsScored: 26.4, pointsAllowed: 18.7 },
    opponents: [{ team: 'Away 0', season: 2026, games: 8, pointsScored: 21.5, pointsAllowed: 24 }],
    samples: [7, -3, 10, -14].map((value, index) => ({ value, date: new Date(now - (index + 1) * 7 * 86400000).toISOString() })),
    risks: ['Experimental, uncalibrated baseline; not a promise of profit.'] };
  const text = scoreboardBreakdown(pick);
  assert.equal(text.split('\n\n').length, 4);
  assert.match(text, /Home 0 \+3.5 to cover the spread/);
  assert.match(text, /26\.4 points per game, compared with 21\.5/);
  assert.match(text, /more productive offense/);
  assert.match(text, /18\.7 points per game, while Away 0 allow 24\.0/);
  assert.match(text, /stronger defensive record/);
  assert.match(text, /won two of their last three recorded games/);
  assert.ok(text.split(/\s+/).length < 180);
  assert.doesNotMatch(text, /expected value|uncalibrated|promise of profit|prior games|Saved selection|Saved pregame price/);
  const tougher = scoreboardBreakdown({ ...pick, teamContext: { ...pick.teamContext, pointsScored: 19, pointsAllowed: 28 } });
  assert.match(tougher, /challenge for the pick rather than an offensive advantage/);
  assert.match(tougher, /defense a concern/);
  assert.doesNotMatch(tougher, /Home 0 have been the more productive offense|Home 0 have allowed fewer points/);
  const missing = scoreboardBreakdown({ ...pick, opponents: [{ ...pick.opponents[0], season: 2025 }], samples: [] });
  assert.match(missing, /not enough verified/);
  assert.doesNotMatch(missing, /26\.4|24\.0|Recent form/);
  const tied = scoreboardBreakdown({ ...pick, teamContext: { ...pick.teamContext, pointsScored: 21.5, pointsAllowed: 24 } });
  assert.match(tied, /Neither team has a scoring-average advantage/);
  assert.match(tied, /neither has an edge on this measure/);
});
test('Live bells reserve a shared middle column while retaining a 44px hit target', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-areas: "status bell teams" "footer footer footer"/);
  assert.match(css, /grid-template-columns: 54px 44px minmax\(0, 1fr\)/);
  assert.match(css, /\.notification-bell \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.notification-game-card\.is-live-game \.notification-bell svg \{ width: 14px; height: 14px/);
  const nfl = readFileSync(new URL('../src/TheWire.tsx', import.meta.url), 'utf8');
  assert.match(nfl, /notification-game-card\$\{live \? ' is-live-game'/);
  assert.match(nfl, /<\/button>\s*\{pick && <details className="wire-game-pick">/);
  assert.match(nfl, /teamPicks\[`\$\{game.eventId\}:\$\{team.id\}`\] && <span className="wire-team-pick-note">GamewAIre Pick/);
  assert.doesNotMatch(nfl, /Saved pregame price:/);
  assert.match(css, /\.wire-team-pick-note \{[^}]*background: #c62836;[^}]*color: #fff/);
  assert.match(css, /b:has\(\.wire-team-pick-note\) \{ flex-wrap: wrap/);
});
test('B2B schedule fetch is independent of box-score preloads and keeps saved-note subscription', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetchNBAScoreboard\(previousNBADate, controller\.signal\)/);
  assert.match(source, /\[warmNBA, previousNBADate, nbaRetry\]/);
  assert.match(source, /kind: 'scoreboard', key: `NBA:\$\{previousNBADate\}`/);
});
