import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { captureRecipe, settingsHash } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';

// Slice 2 of #49 (R5.7): the content box is part of the recorded scope, not a global setting.
const settle = { waitMs: 0, selectors: [], masks: [], disableMotion: true };
const side = targets => ({ side: 'local', settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle },
  settings: { sides: { local: { settle } }, targets } });
const entry = (run, id) => {
  const recipe = captureRecipe(run.settings, 'local', run.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};

test('the recipe records the border box by default and the content box when declared (R5.7)', () => {
  const run = side([{ id: 'plain' }, { id: 'card', selector: '.card' }, { id: 'inner', selector: ['.a', '.b'], box: 'content' }]);
  assert.deepEqual(entry(run, 'plain').recipe.scope, { selector: null, box: 'border' });
  assert.deepEqual(entry(run, 'card').recipe.scope, { selector: '.card', box: 'border' });
  assert.deepEqual(entry(run, 'inner').recipe.scope, { selector: ['.a', '.b'], box: 'content' });
});

test('a border box and a content box of one target are incompatible, and the diagnostic names the box (R5.7, R8.16)', () => {
  const border = side([{ id: 'card', selector: '.card' }, { id: 'other', selector: '.other', box: 'content' }]);
  const content = side([{ id: 'card', selector: '.card', box: 'content' }, { id: 'other', selector: '.other', box: 'content' }]);
  assert.equal(comparisonState(entry(border, 'card'), entry(content, 'card'), border, content), 'incompatible');
  assert.equal(incompatibleDiagnostic(border, content, entry(border, 'card'), entry(content, 'card')),
    'Capture settings differ: scope.box (A: "border", B: "content").');
  // The sibling target has the same content box on both sides. It stays comparable.
  assert.equal(comparisonState(entry(border, 'other'), entry(content, 'other'), border, content), 'complete');
  assert.equal(comparisonState(entry(content, 'card'), entry(content, 'card'), content, content), 'complete');
});

test('a stored content box on a target with no selector is not a valid recipe (R5.7)', () => {
  const run = side([{ id: 'page', box: 'content' }]);
  assert.throws(() => captureRecipe(run.settings, 'local', run.settings.targets[0]), /Invalid stored screenshot box/);
  assert.equal(comparisonState(entry(side([{ id: 'page' }]), 'page'), { targetId: 'page', state: 'captured' }, side([{ id: 'page' }]), run), 'incompatible');
});

test('configuration accepts only border or content, and only with a selector (R5.7)', () => {
  const input = box => ({ schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } }, viewports: [{ id: 'desktop', width: 800, height: 600 }],
    targets: [{ id: 'card', kind: 'component', path: '/', selector: '.card', ...(box === undefined ? {} : { box }) }] });
  assert.equal(normalizeConfig(input('content')).targets[0].box, 'content');
  assert.equal(normalizeConfig(input('border')).targets[0].box, 'border');
  assert.equal(normalizeConfig(input()).targets[0].box, undefined);
  for (const box of ['padding', 'margin', '', null, true, ['content']]) assert.throws(() => normalizeConfig(input(box)), /target\.box/, String(box));
});
