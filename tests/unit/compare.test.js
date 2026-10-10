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

test('settlement hashes isolate targets and selected side overrides', async () => {
  const { settleRecipe, settlementMatches, screenshotScope, scopeMatches, settingsHash } = await import('../../src/config/settings.js');
  const config = { sides: { local: { settle: { waitMs: 0, selectors: [], masks: [], disableMotion: true } },
    other: { settle: { waitMs: 0, selectors: [], masks: [], disableMotion: true } } } };
  const target = { id: 'home', settle: { waitMs: 5 }, settleBySide: { local: { reveal: [{ action: 'click', selector: '.menu' }] }, other: { waitMs: 10 } } };
  const capture = { settleHash: settingsHash(settleRecipe(config, 'local', target)), scopeHash: settingsHash(screenshotScope(target, 'local')) };
  assert.equal(settlementMatches(capture, config, 'local', target), true);
  assert.equal(scopeMatches(capture, screenshotScope(target, 'local')), true);
  const unrelated = { ...target, settleBySide: { ...target.settleBySide, other: { waitMs: 99 } } };
  assert.equal(settlementMatches(capture, config, 'local', unrelated), true);
  assert.equal(scopeMatches(capture, screenshotScope(unrelated, 'local')), true);
  const changed = { ...target, settle: { waitMs: 6 } };
  assert.equal(settlementMatches(capture, config, 'local', changed), false);
  assert.equal(scopeMatches(capture, screenshotScope(changed, 'local')), true);
  assert.equal(settlementMatches({}, config, 'local', target), false);
  assert.equal(scopeMatches({}, screenshotScope(target, 'local')), true);
  assert.equal(settlementMatches({ ...capture, settleHash: 'tampered' }, config, 'local', target), false);
});

test('hashless settlement is limited to the legacy recipe', async () => {
  const { settlementMatches, screenshotScope, scopeMatches } = await import('../../src/config/settings.js');
  const config = settle => ({ sides: { local: { settle } } });
  const legacy = { waitMs: 10, selectors: ['.ready'], masks: [], disableMotion: true };
  assert.equal(settlementMatches({}, config(legacy), 'local', {}), true);
  assert.equal(settlementMatches({}, config({ ...legacy, reveal: [], lazyImages: false }), 'local', {}), true);
  assert.equal(settlementMatches({}, config({ ...legacy, reveal: [{ action: 'focus', selector: '.field' }] }), 'local', {}), false);
  assert.equal(settlementMatches({}, config({ ...legacy, lazyImages: true }), 'local', {}), false);
  assert.equal(settlementMatches({}, config(legacy), 'local', { settle: {} }), false);
  assert.equal(settlementMatches({}, config(legacy), 'local', { settleBySide: { local: {} } }), false);
  assert.equal(settlementMatches({}, config(legacy), 'local', { settleBySide: { other: { waitMs: 100 } } }), true);
  assert.equal(scopeMatches({}, screenshotScope({ settleBySide: { local: {} } }, 'local')), true);
  assert.equal(scopeMatches({}, screenshotScope({ settleBySide: { other: {} } }, 'local')), true);
});

test('stored settlement recipes are bounded before hash comparison', async () => {
  const { settleRecipe, settlementMatches, screenshotScope } = await import('../../src/config/settings.js');
  const config = { sides: { local: { settle: { waitMs: 0 } } } };
  assert.deepEqual(settleRecipe(config, 'local', {}), { waitMs: 0, selectors: [], disableMotion: true, masks: [] });
  for (const recipe of [{ reveal: [{ action: 'execute', selector: '.button' }] }, { lazyImages: 1 }, { waitMs: Infinity }, { selectors: ['x'.repeat(1001)] }]) {
    assert.throws(() => settleRecipe({ sides: { local: { settle: recipe } } }, 'local', {}), /Invalid configuration/);
    assert.throws(() => settlementMatches({}, config, 'local', { settle: recipe }), /Invalid configuration/);
    assert.throws(() => screenshotScope({ settleBySide: { local: recipe } }, 'local'), /Invalid configuration/);
  }
});

test('equivalent settlement overrides retain comparison compatibility', async () => {
  const { settleRecipe, settingsHash, screenshotScope } = await import('../../src/config/settings.js');
  const target = { id: 'home' };
  const settings = { sides: { local: { settle: { waitMs: 0 } } }, targets: [target] };
  const run = { side: 'local', settings, tools: [] };
  const shot = { targetId: 'home', state: 'captured', settleHash: settingsHash(settleRecipe(settings, 'local', target)), scopeHash: settingsHash(screenshotScope(target)) };
  for (const settle of [{}, { waitMs: 0 }]) {
    const other = { ...run, settings: { ...settings, targets: [{ ...target, settle }] } };
    assert.equal(comparisonState(shot, shot, run, other), 'complete');
  }
  const changed = { ...run, settings: { ...settings, targets: [{ ...target, settle: { waitMs: 1 } }] } };
  assert.equal(comparisonState(shot, shot, run, changed), 'incompatible');
});
