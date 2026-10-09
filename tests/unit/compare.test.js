import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState } from '../../src/compare/runs.js';

test('missing failed and incompatible captures remain distinct', () => {
	const run = { settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }] };
	const shot = { state: 'captured' };
	assert.equal(comparisonState(shot, null, run, run), 'missing');
	assert.equal(comparisonState(shot, { state: 'failed' }, run, run), 'failed');
	assert.equal(comparisonState(shot, shot, run, { ...run, settingsHash: 'other' }), 'incompatible');
	assert.equal(comparisonState(shot, shot, run, { ...run, tools: [{ name: 'playwright', version: '2' }] }), 'incompatible');
	assert.equal(comparisonState(shot, shot, run, run), 'complete');
	assert.equal(comparisonState(shot, shot, { ...run, settings: { viewports: [{ width: 800 }] } }, { ...run, settings: { viewports: [{ width: 1600 }] } }), 'incompatible');
});

 test('a changed scope blocks only its target, and stored scope hashes cannot drift', async () => {
  const { settingsHash, screenshotScope } = await import('../../src/config/settings.js');
  const target = { id: 'card', selector: '.card' };
  const run = { settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], settings: { targets: [target, { id: 'other', selector: '.other' }] } };
  const shot = { state: 'captured', targetId: 'card', scopeHash: settingsHash(screenshotScope(target)) };
  const change = targets => ({ ...run, settings: { targets } });
  assert.equal(comparisonState(shot, shot, run, change([{ ...target, selector: '.changed' }])), 'incompatible');
  assert.equal(comparisonState(shot, shot, run, change([{ ...target, box: 'content' }])), 'incompatible');
  assert.equal(comparisonState(shot, shot, run, change([target, { id: 'other', selector: '.changed' }])), 'complete');
  assert.equal(comparisonState(shot, { ...shot, scopeHash: 'tampered' }, run, run), 'incompatible');
 });

 test('new scoped modes require provenance while old string captures remain readable', () => {
  const run = selector => ({ settingsHash: 'same', tools: [], settings: { targets: [{ id: 'card', selector }] } });
  const shot = { targetId: 'card', state: 'captured' };
  assert.equal(comparisonState(shot, shot, run('.card'), run('.card')), 'complete');
  assert.equal(comparisonState(shot, shot, run(['.card']), run(['.card'])), 'incompatible');
  assert.equal(comparisonState(shot, shot, run([]), run([])), 'incompatible');
 });
