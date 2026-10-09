import test from 'node:test';
import assert from 'node:assert/strict';
import { planLegacySelection } from '../../src/compat/selection.js';
import { planLegacySelection as rootSelection } from '../../src/index.js';

const labels = input => planLegacySelection(input).map(row => row.label);

test('all names select references and named missing targets in stable order', () => {
  const input = { harvested: ['component-card--small.png', 'component-button.png'], names: ['button', 'card', 'footer'] };
  assert.deepEqual(labels(input), ['component-card--small', 'component-button', 'component-footer']);
  assert.equal(rootSelection, planLegacySelection);
});
test('literal bare names include variants but exclude similar names and siblings', () => {
  const harvested = ['component-card.png', 'component-card--small.png', 'component-card--large.png', 'component-card-other.png'];
  assert.deepEqual(labels({ harvested, names: ['card'] }), ['component-card', 'component-card--small', 'component-card--large']);
  assert.deepEqual(labels({ harvested, names: ['card--small'] }), ['component-card--small']);
});
test('missing variant before base remains two render-only targets', () => {
  assert.deepEqual(labels({ names: ['card--small', 'card'] }), ['component-card--small', 'component-card']);
  assert.deepEqual(planLegacySelection({ names: ['card--small'] }), [{ label: 'component-card--small', kind: 'component', component: 'card', variant: 'small', renderOnly: true }]);
});
test('full sweep includes noReference but a named sweep does not', () => {
  const input = { harvested: ['component-card--small.png'], noReference: ['card', 'footer', 'home'], manifest: [{ component: 'home', type: 'page' }] };
  assert.deepEqual(labels(input), ['component-card--small', 'component-footer', 'page-home']);
  assert.deepEqual(labels({ ...input, names: ['card'] }), ['component-card--small']);
});
test('TYPE applies after cross-namespace reference existence', () => {
  assert.deepEqual(labels({ harvested: ['component-card.png', 'page-card.png'], names: ['card'], type: 'page' }), ['page-card']);
  assert.deepEqual(labels({ harvested: ['component-card.png'], names: ['card'], manifest: [{ component: 'card', type: 'page' }], type: 'page' }), []);
  assert.deepEqual(labels({ harvested: ['component-page-card.png'], names: ['page-card'] }), ['component-page-card']);
});
test('duplicates do not reorder references or add rows', () => {
  assert.deepEqual(labels({ harvested: ['component-card.png', 'page-home.png', 'component-card.png'], names: ['card', 'card', 'home'] }), ['component-card', 'page-home']);
});
test('multiple variant delimiters and an empty suffix preserve literal legacy labels', () => {
  assert.deepEqual(planLegacySelection({ harvested: ['component-card--small--wide.png', 'component-card--.png'] }).map(row => [row.component, row.variant]), [['card', 'small--wide'], ['card', '']]);
});
test('object-key names are ordinary bounded labels', () => {
  assert.deepEqual(labels({ names: ['constructor', 'toString'] }), ['component-constructor', 'component-toString']);
});
test('input and all nested arrays remain unchanged', () => {
  const input = { harvested: Object.freeze(['component-card.png']), names: Object.freeze(['card']), manifest: Object.freeze([Object.freeze({ component: 'card' })]) };
  Object.freeze(input);
  assert.deepEqual(labels(input), ['component-card']);
});
test('invalid data fails explicitly without path interpretation', () => {
  const bad = [null, [], { unknown: 1 }, { names: 'card' }, { names: [null] }, { type: 'PAGE' }, { manifest: [null] }, { manifest: [{ component: 'card', type: 'other' }] }, { manifest: [{ component: 'card' }, { component: 'card', type: 'page' }] }, { harvested: ['component-card.PNG'] }, { harvested: ['card.png'] }, { names: ['x'.repeat(129)] }, { names: Array(10001).fill('x') }];
  for (const value of ['', '../card', 'card/path', 'card\\path', '%2fcard', 'card\n', '__proto__', '*']) bad.push({ names: [value] });
  for (const value of bad) assert.throws(() => planLegacySelection(value), /Invalid legacy selection/);
});
test('package subpath resolves without a browser dependency', async () => {
  const entry = await import('@parisek/test-kit/compat/selection');
  assert.equal(entry.planLegacySelection, planLegacySelection);
});
