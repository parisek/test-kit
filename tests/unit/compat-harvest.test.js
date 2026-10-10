import test from 'node:test';
import assert from 'node:assert/strict';
import { planLegacyHarvest, legacyHarvestForce } from '../../src/compat/harvest-plan.js';
const base = { manifest: [{ component: 'card' }, { component: 'card', variant: 'wide', viewports: ['desktop'] }, { component: 'home', type: 'page' }], viewports: { desktop: {}, mobile: {} } };

test('harvest keeps existing references per viewport before capture', () => {
  const plan = planLegacyHarvest({ ...base, existing: { desktop: ['component-card.png', 'component-card--wide.png'], mobile: ['page-home.png'] } });
  assert.deepEqual(plan.rows.map(row => [row.viewport, row.filename, row.action]), [
    ['desktop', 'component-card.png', 'keep'], ['mobile', 'component-card.png', 'capture'],
    ['desktop', 'component-card--wide.png', 'keep'], ['desktop', 'page-home.png', 'capture'], ['mobile', 'page-home.png', 'keep']]);
  assert.equal(plan.kept, 3); assert.equal(plan.capture, 2);
  assert.ok(plan.rows.every(row => !Object.hasOwn(row, 'path')));
});
test('FORCE values retain the exact legacy environment contract', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'Yes']) assert.equal(legacyHarvestForce(value), true);
  for (const value of [undefined, '', '0', 'false', 'no', ' true ', 'on']) assert.equal(legacyHarvestForce(value), false);
  assert.throws(() => legacyHarvestForce(true), /Invalid legacy harvest/);
  const plan = planLegacyHarvest({ ...base, force: true, existing: { desktop: ['component-card.png'] } });
  assert.equal(plan.kept, 0); assert.equal(plan.capture, 5);
});
test('all literal names and TYPE apply independently; harvest retains its variant asymmetry', () => {
  assert.equal(planLegacyHarvest({ ...base, names: ['card', 'home', 'card'] }).capture, 5);
  assert.deepEqual(planLegacyHarvest({ ...base, names: ['card'] }).rows.map(row => row.label), ['component-card', 'component-card', 'component-card--wide']);
  assert.equal(planLegacyHarvest({ ...base, names: ['card--wide'] }).capture, 0);
  assert.equal(planLegacyHarvest({ ...base, names: ['card'], type: 'page' }).capture, 0);
  assert.equal(planLegacyHarvest({ ...base, type: 'page' }).capture, 2);
});
test('all-kept and empty selections report explicit counts', () => {
  const plan = planLegacyHarvest({ ...base, type: 'page', existing: { desktop: ['page-home.png'], mobile: ['page-home.png'] } });
  assert.equal(plan.capture, 0); assert.equal(plan.kept, 2);
  assert.deepEqual(planLegacyHarvest({ ...base, names: ['missing'] }), { rows: [], kept: 0, capture: 0 });
});
test('ambiguous writes, paths, unknown viewports and unbounded data fail', () => {
  for (const extra of [{ manifest: [] }, { force: '1' }, { type: 'PAGE' }, { viewports: {} }, { names: ['../card'] }, { existing: { other: [] } }, { existing: { desktop: ['../component-card.png'] } },
    { manifest: [{ component: 'card', viewports: ['other'] }] }, { manifest: [{ component: 'card', viewports: ['desktop', 'desktop'] }] },
    { manifest: [{ component: 'card' }, { component: 'card' }] }, { manifest: [{ component: 'card--wide' }, { component: 'card', variant: 'wide' }] },
    { manifest: Array(1001).fill({ component: 'card' }) }, { names: Array(1001).fill('card') }, { unsupported: true }]) {
    assert.throws(() => planLegacyHarvest({ ...base, ...extra }), /Invalid legacy harvest/);
  }
});
test('planning does not mutate parsed input or depend on a browser', async () => {
  const input = Object.freeze({ manifest: Object.freeze([Object.freeze({ component: 'card', viewports: Object.freeze(['desktop']) })]), viewports: Object.freeze({ desktop: Object.freeze({}) }), existing: Object.freeze({ desktop: Object.freeze(['component-card.png']) }) });
  assert.equal(planLegacyHarvest(input).kept, 1);
  const root = await import('../../src/index.js'); const entry = await import('@parisek/test-kit/compat/harvest');
  assert.equal(root.planLegacyHarvest, planLegacyHarvest); assert.equal(entry.legacyHarvestForce, legacyHarvestForce);
});
