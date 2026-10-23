import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readNFLActiveSkillRoster } from '../src/services/sportsData.ts';
import { emptyFantasyGraphic, readFantasyGraphic, fantasyGraphicPublishError, readFantasyGraphicRows, graphicPlayerMatchup } from '../src/services/fantasyGraphics.ts';

const player = (id) => ({ id: String(id), name: `Player ${id}`, position: 'QB', teamId: '9', teamAbbr: 'GB',
  headshot: `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`, opponent: 'DET',
  opponentLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png', matchup: 'VS' });
const complete = () => ({ kind: 'start', position: 'QB',
  slots: [1, 2, 3, 4].map((id) => ({ player: player(id), reason: 'A verified matchup and an admin opinion.' })) });

test('Fantasy opens to Start/Sit with its tab first while explicit news links retain their destination', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const \[fantasyMode, setFantasyMode\] = useState<[^;]+>\('StartSit'\)/);
  const tabs = app.slice(app.indexOf('aria-label="Fantasy view"'), app.indexOf("(['top', 'hate']"));
  const order = [...tabs.matchAll(/onClick=\{\(\) => setFantasyMode\('([^']+)'\)\}/g)].map((match) => match[1]);
  assert.deepEqual(order, ['StartSit', 'News', 'Matchups', 'Hate']);
  assert.match(app, /if \(next === 'news'\) setFantasyMode\('News'\)/);
});

async function rosterLoader(fetchRoster) {
  const compiled = ts.transpileModule(readFileSync(new URL('../src/services/fantasyGraphicRoster.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import \{ readNFLActiveSkillRoster \} from [^;]+;/, 'const readNFLActiveSkillRoster = (value) => value; let rosterFetch; export const setRoster = (loader) => { rosterFetch = loader; };')
    .replace(/import \{ publicSupabaseConfig \} from [^;]+;/, 'const publicSupabaseConfig = { url: "https://fixture.supabase.co" };')
    .replace('const request = fetch(', 'const request = rosterFetch(')
    .replace(/from ['"]\.\/fantasyGraphics['"]/g, `from '${new URL('../src/services/fantasyGraphics.ts', import.meta.url)}'`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  module.setRoster(async (url) => ({ ok: true, json: async () => fetchRoster('football/nfl', url.searchParams.get('team'), Number(url.searchParams.get('season'))) }));
  return module.fetchFantasyGraphicRoster;
}

test('Player search loads all 32 real team routes without the browser-blocked directory, including bye teams', async () => {
  const requests = [];
  const loader = await rosterLoader(async (feed, teamId, season) => {
    requests.push({ feed, teamId, season });
    return [{ id: teamId, name: `Player ${teamId}`, position: 'QB', headshot: '' }];
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('The team directory is not browser-readable'); };
  try {
    const result = await loader(2026, [], new AbortController().signal);
    assert.equal(requests.length, 32);
    assert.equal(new Set(requests.map((request) => request.teamId)).size, 32);
    assert.ok(requests.some((request) => request.teamId === '9'));
    assert.ok(requests.every((request) => request.feed === 'football/nfl' && request.season === 2026));
    assert.equal(result.players.length, 32);
    assert.equal(result.players.find((player) => player.teamId === '9').teamAbbr, 'GB');
    assert.equal(result.players.find((player) => player.teamId === '9').matchup, 'TBD');
    assert.equal(result.warning, '');
  } finally { globalThis.fetch = originalFetch; }
});

test('Search preserves partial successes, reports all-roster failures, and rejects cancellation', async () => {
  const loader = await rosterLoader(async (_, teamId) => {
    if (teamId === '22') throw new Error('HTTP 503');
    if (teamId !== '9') return [];
    return [{ id: '4036378', name: 'Jordan Love', position: 'QB', headshot: '' }];
  });

  const result = await loader(2026, [], new AbortController().signal);
  assert.equal(result.players.length, 1);
  assert.match(result.warning, /ARI: HTTP 503/);
  assert.doesNotMatch(result.warning, /No active players/);
  const empty = await rosterLoader(async () => []);
  await assert.rejects(empty(2026, [], new AbortController().signal), /No active players could be loaded/);
  const failed = await rosterLoader(async () => { throw new Error('offline'); });
  await assert.rejects(failed(2026, [], new AbortController().signal), /Retry player search/);
  const controller = new AbortController();
  const cancelled = await rosterLoader(async () => { controller.abort(); return []; });
  await assert.rejects(cancelled(2026, [], controller.signal), /cancelled/);
});

test('Gateway roster parsing preserves existing active skill-player and injury rules', () => {
  const athlete = (id, position, type, injuries = []) => ({ id, displayName: `Player ${id}`, position: { abbreviation: position },
    status: { type }, headshot: { href: `https://a.espncdn.com/${id}.png` }, injuries });
  const parsed = readNFLActiveSkillRoster({ athletes: [{ items: [
    athlete('1','QB','active'), athlete('2','RB','day-to-day'), athlete('3','G','active'),
    athlete('4','WR','practice-squad'), athlete('5','TE','injured-reserve'),
    athlete('6','WR','active',[{ status:'Out' }]),
  ] }] });
  assert.deepEqual(parsed.map((player) => player.id), ['1','2']);
  assert.equal(parsed[0].headshot, 'https://a.espncdn.com/1.png');
  assert.throws(() => readNFLActiveSkillRoster({}), /invalid team roster/);
});

test('Four-slot drafts are independent and support both headings and all positions', () => {
  const a = emptyFantasyGraphic(), b = emptyFantasyGraphic();
  a.slots[0].reason = 'Unsaved opinion';
  assert.equal(b.slots[0].reason, '');
  assert.equal(a.slots[1].reason, '');
  for (const kind of ['start', 'sit']) for (const position of ['QB', 'RB', 'WR', 'TE']) {
    assert.equal(readFantasyGraphic({ ...b, kind, position }).position, position);
  }
  assert.equal(fantasyGraphicPublishError(b).includes('all four'), true);
  assert.equal(fantasyGraphicPublishError(complete()), '');
});

test('Incomplete, duplicate, wrong-position, unsafe image, and oversized graphics fail explicitly', () => {
  for (const change of [
    { id: 'not-an-id' }, { position: 'RB' }, { headshot: 'https://example.com/face.png' },
    { opponentLogo: 'javascript:alert(1)' }, { name: '' }, { teamId: 'bad' }, { matchup: 'invented' },
  ]) {
    const graphic = complete();
    graphic.slots[0].player = { ...graphic.slots[0].player, ...change };
    assert.throws(() => readFantasyGraphic(graphic), /invalid player/);
  }
  const duplicate = complete(); duplicate.slots[1].player = player(1);
  assert.throws(() => readFantasyGraphic(duplicate), /only once/);
  const oversized = complete(); oversized.slots[0].reason = 'x'.repeat(651);
  assert.throws(() => readFantasyGraphic(oversized), /650/);
  const noPhoto = complete(); noPhoto.slots[0].player.headshot = '';
  assert.match(fantasyGraphicPublishError(noPhoto), /no ESPN headshot/);
  const noReason = complete(); noReason.slots[0].reason = '  ';
  assert.match(fantasyGraphicPublishError(noReason), /reasoning/);
  assert.throws(() => readFantasyGraphic({ ...complete(), slots: [] }), /layout/);
});

test('Opponents use selected games and distinguish home, away, and unknown without inventing a bye', () => {
  const games = [{ league: 'NFL', home: { id: '9', abbr: 'GB', logo: '' }, away: { id: '8', abbr: 'DET', logo: 'https://a.espncdn.com/det.png' } }];
  assert.deepEqual(graphicPlayerMatchup('9', games), { matchup: 'VS', opponent: 'DET', opponentLogo: 'https://a.espncdn.com/det.png' });
  assert.equal(graphicPlayerMatchup('8', games).matchup, '@');
  assert.deepEqual(graphicPlayerMatchup('99', games), { matchup: 'TBD', opponent: '', opponentLogo: '' });
});

test('Shared and published graphic snapshots retain full player identity and reasoning separately', () => {
  const published = complete(), draft = complete(); draft.slots[0].reason = 'Private draft revision';
  const rows = [{ id: 'test', season: 2026, week: 7, revision: 2, updated_at: new Date().toISOString(), content: draft, published_content: published }];
  const [row] = readFantasyGraphicRows(rows);
  assert.equal(row.content.slots[0].reason, 'Private draft revision');
  assert.equal(row.published_content.slots[0].reason, published.slots[0].reason);
  assert.throws(() => readFantasyGraphicRows({}), /Could not read/);
  assert.throws(() => readFantasyGraphicRows([{ ...rows[0], revision: '2' }]), /invalid/);
});
