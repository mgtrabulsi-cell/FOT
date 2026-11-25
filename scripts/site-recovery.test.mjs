import assert from 'node:assert/strict';
import test from 'node:test';
import { recoveryPermitted, recoverSite } from './site-recovery.mjs';

const now = Date.parse('2026-11-26T06:00:00Z');
const failed = { ok: false, recoveryAllowed: true, checkedAt: new Date(now).toISOString(),
  static: { ok: false }, browser: { ok: false }, runtimeErrorCount: 0 };
test('Automatic repair only permits missing assets and respects the six-hour limit and active deploys', () => {
  assert.equal(recoveryPermitted(failed, [], now), true);
  assert.equal(recoveryPermitted({ ...failed, recoveryAllowed: false }, [], now), false);
  assert.equal(recoveryPermitted({ ...failed, ok: true }, [], now), false);
  assert.equal(recoveryPermitted(failed, [{ status: 'in_progress' }], now), false);
  const run = { event: 'workflow_dispatch', actor: { login: 'github-actions[bot]' },
    created_at: new Date(now - 6 * 3600000 + 1).toISOString() };
  assert.equal(recoveryPermitted(failed, [run], now), false);
  assert.equal(recoveryPermitted(failed, [{ ...run, created_at: new Date(now - 6 * 3600000).toISOString() }], now), true);
});
test('Missing assets dispatch the tested deployment and create a persistent diagnostic incident', async () => {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/runs')) return { workflow_runs: [] };
    if (method === 'GET') return [];
  };
  await recoverSite(failed, api, now);
  assert.equal(calls.filter(call => call.path.includes('/dispatches')).length, 1);
  assert.deepEqual(calls.find(call => call.path.includes('/dispatches')).body, { ref: 'main' });
  assert.match(calls.at(-1).body.body, /fully|tested redeployment/);
});
test('Runtime failures open incidents without blind redeployment; healthy checks close only owned incidents', async () => {
  const calls = [];
  const owned = { number: 3, title: '[Availability] GameWire automatic incident', body: '<!-- gamewire-availability-monitor -->\nPrevious check' };
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    return method === 'GET' ? [owned] : {};
  };
  await recoverSite({ ...failed, recoveryAllowed: false }, api, now);
  assert.equal(calls.some(call => call.path.includes('/dispatches')), false);
  assert.equal(calls.at(-1).path, '/issues/3');
  await recoverSite({ ...failed, ok: true, recoveryAllowed: false, static: { ok: true }, browser: { ok: true } }, api, now);
  assert.equal(calls.at(-1).body.state, 'closed');
});
