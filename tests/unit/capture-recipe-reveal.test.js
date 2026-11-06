import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { captureRecipe, settingsHash } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';

// Slice 5 of #49 (R5.10): reveal steps are a settle key, so they live in recipe.settle.reveal, in order.
const config = (targets, sideSettle) => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080', ...(sideSettle ? { settle: sideSettle } : {}) } }, targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const run = settings => ({ side: 'local', settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle: settings.sides.local.settle }, settings });
const entry = (r, id) => {
  const recipe = captureRecipe(r.settings, 'local', r.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};
const open = { action: 'click', selector: '#open' }, hover = { action: 'hover', selector: '.menu' };

test('the recipe records reveal steps in order, and none by default (R5.10)', () => {
  const r = run(config([{ id: 'plain' }, { id: 'menu', settle: { reveal: [hover, open] } }]));
  assert.equal(entry(r, 'plain').recipe.settle.reveal, undefined);
  assert.deepEqual(entry(r, 'menu').recipe.settle.reveal, [hover, open]);
});

test('a target reveal replaces the side reveal, and an empty list clears it (R5.10)', () => {
  const r = run(config([{ id: 'replace', settle: { reveal: [open] } }, { id: 'clear', settle: { reveal: [] } }, { id: 'inherit' }], { reveal: [hover] }));
  assert.deepEqual(entry(r, 'replace').recipe.settle.reveal, [open]);
  assert.deepEqual(entry(r, 'clear').recipe.settle.reveal, []);
  assert.deepEqual(entry(r, 'inherit').recipe.settle.reveal, [hover]);
});

test('a changed reveal, also a changed order, blocks only its target (R5.10, R8.16)', () => {
  const a = run(config([{ id: 'menu', settle: { reveal: [hover, open] } }, { id: 'other' }]));
  const same = run(config([{ id: 'menu', settle: { reveal: [hover, open] } }, { id: 'other' }]));
  const swapped = run(config([{ id: 'menu', settle: { reveal: [open, hover] } }, { id: 'other' }]));
  const none = run(config([{ id: 'menu' }, { id: 'other' }]));
  assert.equal(comparisonState(entry(a, 'menu'), entry(same, 'menu'), a, same), 'complete');
  assert.equal(comparisonState(entry(a, 'menu'), entry(swapped, 'menu'), a, swapped), 'incompatible');
  assert.equal(comparisonState(entry(a, 'menu'), entry(none, 'menu'), a, none), 'incompatible');
  assert.match(incompatibleDiagnostic(a, none, entry(a, 'menu'), entry(none, 'menu')), /settle\.reveal \(A: \[/);
  assert.equal(comparisonState(entry(a, 'other'), entry(swapped, 'other'), a, swapped), 'complete');
});

test('reveal allows click, hover and focus only, with a bounded selector and list (R5.10)', () => {
  for (const action of ['click', 'hover', 'focus']) assert.doesNotThrow(() => config([{ id: 'a', settle: { reveal: [{ action, selector: '#x' }] } }]));
  const bad = [
    [{ action: 'type', selector: '#x' }], [{ action: 'evaluate', selector: '#x' }], [{ action: 'goto', selector: '/other' }],
    [{ action: 'click', selector: '#x', value: 'text' }], [{ action: 'click' }], [{ action: 'click', selector: '' }],
    [{ action: 'click', selector: 'x'.repeat(2049) }], [{ action: 'click', selector: '.a\n.b' }], 'click', null, {},
    Array.from({ length: 21 }, () => open),
  ];
  for (const reveal of bad) assert.throws(() => config([{ id: 'a', settle: { reveal } }]), /Invalid configuration/, JSON.stringify(reveal)?.slice(0, 60));
  assert.doesNotThrow(() => config([{ id: 'a', settle: { reveal: Array.from({ length: 20 }, () => open) } }]));
});
