import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { captureRecipe, settingsHash } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';

// Slice 3 of #49 (R5.8): per-target settlement, merged over the side default, recorded as recipe.settle.
const base = { waitMs: 0, selectors: [], masks: [], disableMotion: true };
const config = targets => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080', settle: { waitMs: 100, masks: ['.ad'] } }, production: { origin: 'https://example-site.test', remote: true, settle: { waitMs: 200 } } },
  targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const run = (settings, side) => ({ side, settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle: settings.sides[side].settle }, settings });
const entry = (r, id) => {
  const recipe = captureRecipe(r.settings, r.side, r.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};

test('recipe.settle is the side default, then target.settle, then target.settleBySide for the side (R5.8)', () => {
  const settings = config([{ id: 'plain' }, { id: 'merged', settle: { waitMs: 300, masks: [] }, settleBySide: { local: { waitMs: 400 }, production: { disableMotion: false } } }]);
  const settleOf = (id, side) => captureRecipe(settings, side, settings.targets.find(target => target.id === id)).settle;
  assert.deepEqual(settleOf('plain', 'local'), { ...base, waitMs: 100, masks: ['.ad'] });
  assert.deepEqual(settleOf('plain', 'production'), { ...base, waitMs: 200 });
  // Scalars inherit, an explicit array replaces the inherited array, and the side override wins over the target override.
  assert.deepEqual(settleOf('merged', 'local'), { ...base, waitMs: 400, masks: [] });
  assert.deepEqual(settleOf('merged', 'production'), { ...base, waitMs: 300, masks: [], disableMotion: false });
});

test('a settle override changes only the recipe of its own target and side (R5.8, R8.16)', () => {
  const a = run(config([{ id: 'home' }, { id: 'about' }]), 'local');
  const b = run(config([{ id: 'home', settleBySide: { local: { waitMs: 500 } } }, { id: 'about', settleBySide: { production: { waitMs: 500 } } }]), 'local');
  assert.equal(comparisonState(entry(a, 'home'), entry(b, 'home'), a, b), 'incompatible');
  assert.match(incompatibleDiagnostic(a, b, entry(a, 'home'), entry(b, 'home')), /settle\.waitMs \(A: 100, B: 500\)/);
  // An override for another side does not touch this side's recipe.
  assert.equal(comparisonState(entry(a, 'about'), entry(b, 'about'), a, b), 'complete');
});

test('a changed stored settle recipe is incompatible, also when the stored hash was edited to match (R5.8, R8.16)', () => {
  const a = run(config([{ id: 'home' }]), 'local');
  const good = entry(a, 'home');
  const edited = { ...good, recipe: { ...good.recipe, settle: { ...good.recipe.settle, waitMs: 1 } } };
  assert.equal(comparisonState(good, edited, a, a), 'incompatible');
  const rehashed = { ...edited, settleHash: settingsHash(edited.recipe.settle) };
  assert.equal(comparisonState(good, rehashed, a, a), 'incompatible', 'The run settings still decide the effective recipe.');
});

test('target settle keys are bounded and a side in settleBySide must exist (R5.8)', () => {
  const bad = [{ waitMs: -1 }, { waitMs: 10001 }, { waitMs: Infinity }, { selectors: Array.from({ length: 51 }, () => 'a') }, { masks: ['x'.repeat(1001)] },
    { masks: 'a' }, { disableMotion: 'yes' }, { unknown: 1 }, 'text', null];
  for (const settle of bad) {
    assert.throws(() => config([{ id: 'home', settle }]), /Invalid configuration/, JSON.stringify(settle));
    assert.throws(() => config([{ id: 'home', settleBySide: { local: settle } }]), /Invalid configuration/, JSON.stringify(settle));
  }
  assert.throws(() => config([{ id: 'home', settleBySide: { staging: { waitMs: 1 } } }]), /unknown side staging/);
  assert.doesNotThrow(() => config([{ id: 'home', settle: { waitMs: 10000, selectors: Array.from({ length: 50 }, () => 'a') } }]));
});
