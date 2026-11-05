import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { forecastDistribution, distributionAtLine } from '../supabase/functions/_shared/gamewireBotIntelligence.ts';
import { fairAmericanOdds, valueClassification, empiricalQuantile, modelVersion } from '../supabase/functions/_shared/gamewaire.ts';
import { rankWireTeams } from '../src/services/wireTeamPicks.ts';

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
test('Scoreboards select at most three distinct qualifying games without record-based or Watch fillers', () => {
  const result = rankWireTeams(games, picks, now);
  assert.equal(Object.keys(result).length, 3);
  assert.equal(result['3:h3'].rank, 1);
  assert.ok(Object.values(result).every(row => row.label === 'GamewAIre Pick'));
  assert.match(result['3:h3'].reason, /moneyline at -110 \(Saved book\)/);
  assert.match(result['3:h3'].reason, /Role uncertainty/);
  assert.match(result['3:h3'].reason, /not live odds/);
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
test('Live bells reserve a shared middle column while retaining a 44px hit target', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-areas: "status bell teams" "footer footer footer"/);
  assert.match(css, /grid-template-columns: 54px 44px minmax\(0, 1fr\)/);
  assert.match(css, /\.notification-bell \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.notification-game-card\.is-live-game \.notification-bell svg \{ width: 14px; height: 14px/);
  const nfl = readFileSync(new URL('../src/TheWire.tsx', import.meta.url), 'utf8');
  assert.match(nfl, /notification-game-card\$\{live \? ' is-live-game'/);
  assert.match(nfl, /<\/button>\s*\{pick && <details className="wire-game-pick">/);
});
test('B2B schedule fetch is independent of box-score preloads and keeps saved-note subscription', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetchNBAScoreboard\(previousNBADate, controller\.signal\)/);
  assert.match(source, /\[warmNBA, previousNBADate, nbaRetry\]/);
  assert.match(source, /kind: 'scoreboard', key: `NBA:\$\{previousNBADate\}`/);
});
