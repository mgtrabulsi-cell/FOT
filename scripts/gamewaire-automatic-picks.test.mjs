import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWireSelections, syncAutomaticWirePicks, wireDay } from '../supabase/functions/_shared/gamewaireAutomaticPicks.ts';

test('automatic recording keeps exact pregame source/line, skips started picks and propagates database failures', async () => {
  const now = Date.parse('2026-11-10T02:00:00Z');
  const candidate = { start: '2026-11-10T03:00:00Z', market: 'spreads', side: 'Home', line: -3.5 };
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return { data: true }; } };
  assert.equal(await recordWireSelections(admin, [
    { runId: 'original', candidate },
    { runId: 'started', candidate: { ...candidate, start: new Date(now).toISOString() } },
    { runId: 'past', candidate: { ...candidate, start: '2026-11-09T23:00:00Z' } },
  ], now), 1);
  assert.deepEqual(calls, [{ name: 'gamewaire_track_automatic_pick', args: { target_run: 'original', candidate } }]);
  assert.equal(await recordWireSelections({ rpc: async () => ({ data: false }) }, [{ runId: 'duplicate', candidate }], now), 0);
  await assert.rejects(recordWireSelections({ rpc: async () => ({ error: { message: 'Unavailable' } }) },
    [{ runId: 'failed', candidate }], now), /Could not record automatic Wire pick: Unavailable/);
});

test('cron scans upcoming slates without a browser or provider requests, using Eastern calendar dates', async () => {
  assert.equal(wireDay(Date.parse('2026-11-10T02:00:00Z')), '2026-11-09');
  const calls = [];
  const builder = {
    select: (...args) => { calls.push(['select', ...args]); return builder; },
    in: (...args) => { calls.push(['in', ...args]); return builder; },
    gt: (...args) => { calls.push(['gt', ...args]); return builder; },
    lt: (...args) => { calls.push(['lt', ...args]); return builder; },
    order: () => builder, range: () => builder, returns: async () => ({ data: [], error: null }),
  };
  assert.equal(await syncAutomaticWirePicks({ from: () => builder }, Date.parse('2026-11-10T02:00:00Z')), 0);
  assert.deepEqual(calls.find(call => call[0] === 'in'), ['in', 'sport', ['NBA', 'NFL']]);
  assert.deepEqual(calls.find(call => call[0] === 'gt'), ['gt', 'event_start', '2026-11-10T02:00:00.000Z']);
  builder.returns = async () => ({ data: null, error: {} });
  await assert.rejects(syncAutomaticWirePicks({ from: () => builder }), /Could not load upcoming automatic-pick slates/);
});

test('browser-independent sync groups NBA nights and Tuesday-to-Monday NFL weeks once per slate', async () => {
  const slates = [];
  const rows = [
    { sport: 'NFL', event_start: '2026-11-13T01:15:00Z' },
    { sport: 'NFL', event_start: '2026-11-17T01:15:00Z' },
    { sport: 'NBA', event_start: '2026-11-10T03:10:00Z' },
    { sport: 'NBA', event_start: '2026-11-11T01:10:00Z' },
  ];
  const admin = { from(table) {
    let columns, start, end;
    const builder = {
      select: value => { columns = value; return builder; },
      in: () => builder, eq: () => builder, gt: () => builder,
      gte: (_key, value) => { start = value; return builder; },
      lt: (_key, value) => { end = value; return builder; },
      order: () => builder, range: () => builder,
      returns: async () => {
        if (table === 'gamewaire_runs' && columns !== 'sport,event_start') slates.push({ start, end });
        return { data: columns === 'sport,event_start' ? rows : [], error: null };
      },
    };
    return builder;
  } };
  assert.equal(await syncAutomaticWirePicks(admin, Date.parse('2026-11-10T02:00:00Z')), 0);
  assert.equal(slates.length, 3);
  assert.deepEqual(slates[0], { start: '2026-11-09T00:00:00.000Z', end: '2026-11-18T00:00:00.000Z' });
  assert.deepEqual(slates[1], { start: '2026-11-08T00:00:00.000Z', end: '2026-11-11T00:00:00.000Z' });
  assert.deepEqual(slates[2], { start: '2026-11-09T00:00:00.000Z', end: '2026-11-12T00:00:00.000Z' });
});
