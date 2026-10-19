import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, captureSettings, settingsHash } from '../../src/config/index.js';
import { BUILTIN_PACK_IDS, builtinPacks } from '../../src/packs/builtin.js';
import { resolveChecks } from '../../src/packs/index.js';

function input() {
  return { schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } },
    targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
}

test('packs: absent key means no packs, and the rest of the config is unchanged (R13.44, R5.1)', () => {
  const result = normalizeConfig(input());
  assert.deepEqual(result.packs, []);
  assert.deepEqual(result.artifacts, ['screenshot']);
  assert.deepEqual(result.checks, []);
  assert.deepEqual(normalizeConfig({ ...input(), packs: [] }), result);
  const { packs, ...rest } = result;
  assert.deepEqual(Object.keys(rest), ['schemaVersion', 'sides', 'targets', 'viewports', 'artifacts', 'checks', 'content', 'behavior', 'runsRoot', 'screenshot', 'rules', 'known_diffs']);
});

test('packs: known pack IDs are accepted, copied and frozen (R13.44)', () => {
  const source = { ...input(), packs: ['swiper', 'a11y', 'lint'] };
  const result = normalizeConfig(source);
  source.packs[0] = 'changed';
  assert.deepEqual(result.packs, ['swiper', 'a11y', 'lint']);
  assert.throws(() => { result.packs.push('x'); }, TypeError);
  assert.deepEqual(normalizeConfig({ ...input(), packs: ['a11y'] }).packs, ['a11y']);
});

test('packs: unknown, duplicate and malformed entries fail (R13.44)', () => {
  const fails = (packs, pattern) => assert.throws(() => normalizeConfig({ ...input(), packs }), pattern);
  fails(['nope'], /unknown pack \(known: a11y, lint, swiper\)/);
  fails(['a11y', 'a11y'], /pack IDs must be unique/);
  fails('a11y', /packs must have/);
  fails([{ id: 'a11y', options: {} }], /pack ID must be a safe ID/);
  fails([null], /pack ID must be a safe ID/);
  fails(['../a11y'], /pack ID must be a safe ID/);
  fails(['A11Y'], /unknown pack/);
  fails(['a11y', 'lint', 'swiper', 'a11y'], /packs must have/);
});

test('packs: a selected ID resolves to a built-in pack and runs nothing (R13.42, R13.44)', () => {
  assert.deepEqual(builtinPacks.map(pack => pack.id), [...BUILTIN_PACK_IDS]);
  const none = resolveChecks({ available: builtinPacks, packs: normalizeConfig(input()).packs });
  assert.equal(none.checks.length, 0);
  const plan = resolveChecks({ available: builtinPacks, packs: normalizeConfig({ ...input(), packs: ['a11y'] }).packs });
  assert.deepEqual(plan.checks.map(entry => entry.check.id), ['a11y-axe']);
});

test('packs: the selection does not enter capture settings', () => {
  const base = normalizeConfig(input());
  const selected = normalizeConfig({ ...input(), packs: ['a11y'] });
  assert.equal(settingsHash(captureSettings(selected, 'local')), settingsHash(captureSettings(base, 'local')));
});
