// GamewAIre bot input regression: compares the per-game player statistics the bot
// would read from ESPN game logs (parsed with the bot's own botLogRows) against the
// API-Sports rows in live_feed_player_games, matched through the roster bridge.
//
// Usage: node scripts/gamewire-bot-regression.mjs
// Reads VITE_SUPABASE_URL and the public key from .env.local. Exits non-zero on
// any stat mismatch so this can gate the eventual bot input switch.
import { readFileSync } from 'node:fs';
import { botLogRows } from '../supabase/functions/_shared/gamewireBot.ts';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
  const separator = line.indexOf('=');
  if (separator < 1 || line.startsWith('#')) return [];
  return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')]];
}));
const base = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const apikey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!base || !apikey) throw new Error('Supabase URL or public key is missing from .env.local.');

const season = (() => {
  const now = new Date();
  return now.getUTCMonth() + 1 >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
})();

const db = async (path) => {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
};

// ESPN game-log stat names (what the bot reads) mapped to live_feed_player_games keys.
const keyMap = {
  completions: 'completions', passingAttempts: 'attempts', passingYards: 'passingYards',
  passingTouchdowns: 'passingTouchdowns', interceptions: 'interceptions',
  rushingAttempts: 'carries', rushingYards: 'rushingYards', rushingTouchdowns: 'rushingTouchdowns',
  receptions: 'receptions', receivingTargets: 'targets', receivingYards: 'receivingYards',
  receivingTouchdowns: 'receivingTouchdowns',
};

const feedRows = await db(`live_feed_player_games?sport=eq.NFL&season=eq.${season}&api_player_id=neq.game&select=api_player_id,provider_game_id,game_date,stats&limit=20000`);
const byPlayer = new Map();
for (const row of feedRows) byPlayer.set(row.api_player_id, [...(byPlayer.get(row.api_player_id) ?? []), row]);
if (!byPlayer.size) {
  console.log('No synced player games are available yet; run again after the season sync has progressed.');
  process.exit(0);
}
const bridge = await db(`live_feed_rosters?sport=eq.NFL&season=eq.${season}&active=is.true&api_player_id=not.is.null&position=in.(QB,RB,WR,TE)&select=espn_player_id,api_player_id,name,position&limit=3000`);
const candidates = bridge.filter((player) => byPlayer.has(player.api_player_id))
  .sort((first, second) => (byPlayer.get(second.api_player_id)?.length ?? 0) - (byPlayer.get(first.api_player_id)?.length ?? 0));
const sample = [];
for (const position of ['QB', 'RB', 'WR', 'TE']) {
  sample.push(...candidates.filter((player) => player.position === position).slice(0, 4));
}
if (!sample.length) {
  console.log('No bridged players overlap the synced games yet; run again after the roster bridge has synced.');
  process.exit(0);
}
console.log(`Season ${season}: comparing ${sample.length} bridged players across ${byPlayer.size} players with synced games.\n`);

let comparedGames = 0, comparedStats = 0;
const mismatches = [];
const coverageGaps = [];
for (const player of sample) {
  const logResponse = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${player.espn_player_id}/gamelog?season=${season}`, {
    headers: { Accept: 'application/json' },
  });
  if (!logResponse.ok) {
    console.log(`- ${player.name} (${player.position}): ESPN game log returned HTTP ${logResponse.status}; skipped.`);
    continue;
  }
  let espnRows;
  try {
    espnRows = botLogRows(await logResponse.json(), Date.now(), season);
  } catch (cause) {
    console.log(`- ${player.name} (${player.position}): ESPN game log failed validation (${cause.message}); skipped.`);
    continue;
  }
  const feedGames = byPlayer.get(player.api_player_id) ?? [];
  let matched = 0;
  for (const feedGame of feedGames) {
    const feedTime = Date.parse(`${feedGame.game_date}T12:00:00Z`);
    const espnGame = espnRows.find((row) => Math.abs(Date.parse(row.date) - feedTime) <= 36 * 3_600_000);
    if (!espnGame) continue;
    matched++;
    comparedGames++;
    for (const [espnKey, feedKey] of Object.entries(keyMap)) {
      const espnValue = espnGame.stats[espnKey];
      const feedValue = feedGame.stats[feedKey];
      if (espnValue === undefined && feedValue === undefined) continue;
      if (espnValue !== undefined && feedValue !== undefined) {
        comparedStats++;
        if (espnValue !== feedValue) {
          mismatches.push(`${player.name} ${feedGame.game_date} ${espnKey}: ESPN ${espnValue} vs API-Sports ${feedValue}`);
        }
      } else if (espnValue !== undefined && espnValue !== 0) {
        coverageGaps.push(`${player.name} ${feedGame.game_date} ${espnKey}: ESPN ${espnValue}, missing from API-Sports`);
      }
    }
  }
  console.log(`- ${player.name} (${player.position}): ${matched}/${feedGames.length} synced games matched to ESPN logs.`);
}

console.log(`\nCompared ${comparedStats} stat values across ${comparedGames} game matches.`);
if (coverageGaps.length) {
  console.log(`\nCoverage gaps (${coverageGaps.length}):`);
  for (const gap of coverageGaps.slice(0, 20)) console.log(`  ${gap}`);
}
if (mismatches.length) {
  console.log(`\nMISMATCHES (${mismatches.length}):`);
  for (const mismatch of mismatches.slice(0, 40)) console.log(`  ${mismatch}`);
  console.log('\nRegression FAILED: the bot must stay on ESPN inputs until these are explained.');
  process.exit(1);
}
console.log(coverageGaps.length
  ? '\nRegression PASSED on overlapping values, but coverage gaps above must be reviewed before switching the bot.'
  : '\nRegression PASSED: API-Sports player game stats match the ESPN values the bot reads.');
