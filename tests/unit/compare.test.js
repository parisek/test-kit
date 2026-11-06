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

test('the incompatible diagnostic names the differing setting and both values (R8.9)', async () => {
  const { incompatibleDiagnostic } = await import('../../src/compare/runs.js');
  const base = { viewports: [{ id: 'desktop', width: 1280, height: 800 }], settle: { waitMs: 0, lazyImages: false }, screenshot: { fullPage: true } };
  const run = (captureSettings, version = '1') => ({ captureSettings, tools: [{ name: 'playwright', version }] });
  const text = incompatibleDiagnostic(run(base), run({ ...base, settle: { ...base.settle, lazyImages: true } }));
  assert.match(text, /settle\.lazyImages \(A: false, B: true\)/);
  assert.doesNotMatch(text, /settle\.waitMs/);
  assert.match(incompatibleDiagnostic(run(base), run({ ...base, settle: { waitMs: 0 } })), /settle\.lazyImages \(A: false, B: unset\)/);
  assert.match(incompatibleDiagnostic(run(base), run({ ...base, viewports: [{ id: 'desktop', width: 1440, height: 800 }] })), /viewports \(A: /);
  assert.match(incompatibleDiagnostic(run(base), run({ ...base, screenshot: { fullPage: false } })), /screenshot \(A: .*true.*, B: .*false/);
  assert.match(incompatibleDiagnostic(run(base), run(base, '2')), /tool versions \(A: .*1.*, B: .*2.*\)/);
  const listed = { ...base, allowOrigins: [{ origin: 'https://use.example-site.net', types: ['font'] }] };
  assert.match(incompatibleDiagnostic(run(base), run(listed)), /allowOrigins \(A: unset, B: \[/);
  assert.match(incompatibleDiagnostic(run(listed), run(base)), /allowOrigins \(A: \[.*\], B: unset\)/);
  const long = incompatibleDiagnostic(run(base), run({ ...base, settle: { ...base.settle, selectors: ['x'.repeat(500)] } }));
  assert.ok(long.length < 200 && !/\n/.test(long));
  assert.equal(incompatibleDiagnostic(run(base), run(base)), 'Capture settings or tool versions differ.');
});

test('the diagnostic uses the effective settle of the target, with its override (R8.9)', async () => {
  const { incompatibleDiagnostic } = await import('../../src/compare/runs.js');
  const settle = { waitMs: 0, selectors: [], disableMotion: true, masks: [] };
  const run = (target, side) => ({ side, captureSettings: { settle }, tools: [], settings: { sides: { [side]: { settle } }, targets: [target] } });
  const a = run({ id: 'home' }, 'local'), b = run({ id: 'home', settle: { lazyImages: true } }, 'production');
  const shot = { targetId: 'home' };
  assert.equal(incompatibleDiagnostic(a, b), 'Capture settings or tool versions differ.');
  assert.match(incompatibleDiagnostic(a, b, shot, shot), /settle\.lazyImages \(A: unset, B: true\)/);
  const bySide = run({ id: 'home', settleBySide: { production: { waitMs: 500 } } }, 'production');
  assert.match(incompatibleDiagnostic(a, bySide, shot, shot), /settle\.waitMs \(A: 0, B: 500\)/);
});

test('the diagnostic lists at most 5 settings and counts the rest (R8.9)', async () => {
  const { incompatibleDiagnostic } = await import('../../src/compare/runs.js');
  const run = n => ({ captureSettings: { settle: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(key => [key, n])) }, tools: [] });
  const text = incompatibleDiagnostic(run(1), run(2));
  assert.equal(text.match(/settle\./g).length, 5);
  assert.match(text, /; and 2 more\.$/);
});

test('a stored recipe carries the engine version, and a version mismatch blocks only its target (R5.6, R8.16)', async () => {
  const { captureRecipe, recipeVersion, settingsHash, CAPTURE_ENGINE_VERSION } = await import('../../src/config/settings.js');
  const { incompatibleDiagnostic } = await import('../../src/compare/runs.js');
  const settle = { waitMs: 0, selectors: [], masks: [], disableMotion: true };
  const targets = [{ id: 'union', selector: ['#one', '#two'] }, { id: 'plain' }];
  const settings = { sides: { local: { settle } }, targets };
  const run = { side: 'local', settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle }, settings };
  const entry = (target, version = CAPTURE_ENGINE_VERSION) => {
    const recipe = { ...captureRecipe(settings, 'local', target), version };
    return { targetId: target.id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
  };
  assert.deepEqual(captureRecipe(settings, 'local', targets[0]), { version: 1, scope: { selector: ['#one', '#two'], box: 'border' }, settle });
  // An A/A pair with a union reads complete.
  assert.equal(comparisonState(entry(targets[0]), entry(targets[0]), run, run), 'complete');
  // A pair that differs only in the version is incompatible for that target. The other target stays complete.
  assert.equal(comparisonState(entry(targets[0]), entry(targets[0], 2), run, run), 'incompatible');
  assert.equal(comparisonState(entry(targets[1]), entry(targets[1]), run, run), 'complete');
  assert.match(incompatibleDiagnostic(run, run, entry(targets[0]), entry(targets[0], 2)), /recipe\.version \(A: 1, B: 2\)/);
  // An entry with no recipe (a run made before R5.6) reads as the default recipe of version 1.
  const { recipe, ...old } = entry(targets[1]);
  assert.equal(recipeVersion(old), 1);
  assert.equal(comparisonState(old, entry(targets[1]), run, run), 'complete');
  assert.equal(comparisonState(old, entry(targets[1], 2), run, run), 'incompatible');
  // A stored recipe is untrusted: a part that does not hash to its stored hash, or a bad version, is incompatible.
  const forged = entry(targets[0]);
  assert.equal(comparisonState(entry(targets[0]), { ...forged, recipe: { ...forged.recipe, scope: { selector: ['#one'], box: 'border' } } }, run, run), 'incompatible');
  for (const version of [0, -1, 1.5, '1', null]) assert.equal(recipeVersion({ ...forged, recipe: { ...forged.recipe, version } }), null);
  assert.equal(recipeVersion({ ...forged, recipe: [] }), null);
  assert.match(incompatibleDiagnostic(run, run, entry(targets[0]), { ...forged, recipe: { ...forged.recipe, version: 0 } }), /recipe \(A: valid, B: invalid\)/);
  // A legacy union entry keeps its proof in `scopeHash`: with it, it compares to a new entry; without it, it does not.
  const { recipe: unused, ...legacyUnion } = entry(targets[0]);
  assert.equal(comparisonState(legacyUnion, entry(targets[0]), run, run), 'complete');
  const { scopeHash, ...unproven } = legacyUnion;
  assert.equal(comparisonState(unproven, entry(targets[0]), run, run), 'incompatible');
});

test('an incompatible union names the differing scope part with both stored values (R8.16)', async () => {
  const { captureRecipe, settingsHash } = await import('../../src/config/settings.js');
  const { incompatibleDiagnostic } = await import('../../src/compare/runs.js');
  const settle = { waitMs: 0, selectors: [], masks: [], disableMotion: true };
  const side = selector => {
    const targets = [{ id: 'union', selector }, { id: 'plain' }];
    const settings = { sides: { local: { settle } }, targets };
    return { side: 'local', settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle }, settings };
  };
  const entry = (run, id) => {
    const recipe = captureRecipe(run.settings, 'local', run.settings.targets.find(target => target.id === id));
    return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
  };
  const a = side(['#one', '#two']), b = side(['#one']);
  assert.equal(comparisonState(entry(a, 'union'), entry(b, 'union'), a, b), 'incompatible');
  assert.equal(comparisonState(entry(a, 'plain'), entry(b, 'plain'), a, b), 'complete');
  assert.equal(incompatibleDiagnostic(a, b, entry(a, 'union'), entry(b, 'union')),
    'Capture settings differ: scope.selector (A: ["#one","#two"], B: ["#one"]).');
});
