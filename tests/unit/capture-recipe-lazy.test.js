import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { captureRecipe, settingsHash } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';

// Slice 4 of #49 (R5.9): lazy-image settlement is a settle key, so it lives in recipe.settle.
const config = targets => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080' } }, targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const run = settings => ({ side: 'local', settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle: settings.sides.local.settle }, settings });
const entry = (r, id) => {
  const recipe = captureRecipe(r.settings, 'local', r.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};

test('lazy images are off by default and recorded when a target turns them on (R5.9)', () => {
  const r = run(config([{ id: 'plain' }, { id: 'lazy', settle: { lazyImages: true } }]));
  assert.equal(entry(r, 'plain').recipe.settle.lazyImages, undefined);
  assert.equal(entry(r, 'lazy').recipe.settle.lazyImages, true);
});

test('a lazy-image change blocks only its target, and the diagnostic names it (R5.9, R8.16)', () => {
  const a = run(config([{ id: 'home' }, { id: 'about' }]));
  const b = run(config([{ id: 'home', settle: { lazyImages: true } }, { id: 'about' }]));
  assert.equal(comparisonState(entry(a, 'home'), entry(b, 'home'), a, b), 'incompatible');
  assert.match(incompatibleDiagnostic(a, b, entry(a, 'home'), entry(b, 'home')), /settle\.lazyImages \(A: unset, B: true\)/);
  assert.equal(comparisonState(entry(a, 'about'), entry(b, 'about'), a, b), 'complete');
});

test('a target can turn off lazy images that its side turned on (R5.9)', () => {
  const settings = normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
    sides: { local: { origin: 'http://localhost:8080', settle: { lazyImages: true } } }, targets: [{ id: 'off', kind: 'page', path: '/', settle: { lazyImages: false } }] });
  assert.equal(captureRecipe(settings, 'local', settings.targets[0]).settle.lazyImages, false);
});

test('lazyImages accepts only a boolean (R5.9)', () => {
  for (const lazyImages of ['true', 1, null, [], {}]) assert.throws(() => config([{ id: 'home', settle: { lazyImages } }]), /lazyImages/, String(lazyImages));
});
