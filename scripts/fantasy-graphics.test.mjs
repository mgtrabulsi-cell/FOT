import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyFantasyGraphic, readFantasyGraphic, fantasyGraphicPublishError, readFantasyGraphicRows, graphicPlayerMatchup } from '../src/services/fantasyGraphics.ts';

const player = (id) => ({ id: String(id), name: `Player ${id}`, position: 'QB', teamId: '9', teamAbbr: 'GB',
  headshot: `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`, opponent: 'DET',
  opponentLogo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png', matchup: 'VS' });
const complete = () => ({ kind: 'start', position: 'QB',
  slots: [1, 2, 3, 4].map((id) => ({ player: player(id), reason: 'A verified matchup and an admin opinion.' })) });

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
