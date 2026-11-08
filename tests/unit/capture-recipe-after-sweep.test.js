import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { CAPTURE_ENGINE_VERSION, captureRecipe, settingsHash, settlementMatches } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';
import { isTransientFailure } from '../../src/capture/retry.js';

// R5.15: settle.afterSweep is a settle key, so it lives in recipe.settle (R5.6) and merges like pin (R5.8).
const config = (targets, side = {}, production = {}) => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080', ...side }, production: { origin: 'https://example-site.test', remote: true, ...production } },
  targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const run = (settings, side = 'local') => ({ side, settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle: settings.sides[side].settle }, settings });
const entry = (r, id) => {
  const recipe = captureRecipe(r.settings, r.side, r.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};
const settleOf = (settings, id, side = 'local') => captureRecipe(settings, side, settings.targets.find(target => target.id === id)).settle;
const swept = afterSweep => ({ lazyImages: true, afterSweep });

test('afterSweep is off by default and recorded when set (R5.15, R5.6)', () => {
  const settings = config([{ id: 'plain', settle: { lazyImages: true } }, { id: 'waits', settle: swept(['header:not(.scrolled)']) }]);
  assert.equal(Object.hasOwn(settleOf(settings, 'plain'), 'afterSweep'), false);
  assert.deepEqual(settleOf(settings, 'waits').afterSweep, ['header:not(.scrolled)']);
});

test('an unset afterSweep keeps the settle hash of the recipe without the key (R5.15, R8.16)', () => {
  const before = settingsHash(settleOf(config([{ id: 'home', settle: { lazyImages: true } }]), 'home'));
  assert.equal(before, settingsHash({ waitMs: 0, selectors: [], disableMotion: true, masks: [], lazyImages: true }));
  assert.notEqual(settingsHash(settleOf(config([{ id: 'home', settle: swept(['header']) }]), 'home')), before);
});

test('afterSweep merges like other settle keys: arrays replace, [] clears, the side override wins (R5.8, R5.15)', () => {
  const settings = config([
    { id: 'inherit' },
    { id: 'replace', settle: { afterSweep: ['.b'] } },
    { id: 'clear', settle: { afterSweep: [] } },
    { id: 'by-side', settle: { afterSweep: ['.b'] }, settleBySide: { local: { afterSweep: ['.c', '.d'] } } },
  ], { settle: swept(['.a']) }, { settle: { lazyImages: true } });
  assert.deepEqual(settleOf(settings, 'inherit').afterSweep, ['.a']);
  assert.deepEqual(settleOf(settings, 'replace').afterSweep, ['.b']);
  assert.deepEqual(settleOf(settings, 'clear').afterSweep, []);
  assert.deepEqual(settleOf(settings, 'by-side').afterSweep, ['.c', '.d']);
  assert.deepEqual(settleOf(settings, 'by-side', 'production').afterSweep, ['.b']);
  assert.equal(Object.hasOwn(settleOf(settings, 'inherit', 'production'), 'afterSweep'), false);
});

test('afterSweep needs lazyImages true in the effective recipe of every target and side (R5.15, R4.4)', () => {
  // The keys may sit in different layers.
  assert.doesNotThrow(() => config([{ id: 'a', settle: { afterSweep: ['header'] } }], { settle: { lazyImages: true } }, { settle: { lazyImages: true } }));
  assert.doesNotThrow(() => config([{ id: 'a', settleBySide: { local: swept(['header']) } }]));
  assert.throws(() => config([{ id: 'a', settle: { afterSweep: ['header'] } }]), /target a on side local: settle\.afterSweep needs lazyImages true/);
  assert.throws(() => config([{ id: 'a', settle: { afterSweep: ['header'] } }], { settle: { lazyImages: false } }), /afterSweep needs lazyImages true/);
  assert.throws(() => config([{ id: 'a' }], { settle: { afterSweep: ['header'] } }), /sides\.local\.settle\.afterSweep needs lazyImages true/);
  // A side override that turns the sweep off fails for that side only, and names it.
  assert.throws(() => config([{ id: 'a', settle: swept(['header']), settleBySide: { production: { lazyImages: false } } }]), /target a on side production/);
  // An empty list waits for nothing, so it is valid without the sweep. It is how a target clears an inherited list.
  assert.doesNotThrow(() => config([{ id: 'a', settle: { afterSweep: [] } }]));
  assert.doesNotThrow(() => config([{ id: 'a', settle: { lazyImages: false, afterSweep: [] } }], { settle: swept(['header']) }));
});

test('afterSweep accepts 0 to 20 bounded plain selectors and rejects the rest (R5.15)', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `.p${index}`);
  assert.equal(settleOf(config([{ id: 'a', settle: swept(twenty) }]), 'a').afterSweep.length, 20);
  assert.equal(settleOf(config([{ id: 'a', settle: swept(['x'.repeat(2048)]) }]), 'a').afterSweep[0].length, 2048);
  for (const afterSweep of [[...twenty, '.extra'], ['x'.repeat(2049)], [''], ['  '], ['a\nb'], [1], [null], 'header', {}, null, 1, [['header']]]) {
    assert.throws(() => config([{ id: 'a', settle: swept(afterSweep) }]), /afterSweep/, JSON.stringify(afterSweep)?.slice(0, 40));
  }
  assert.throws(() => config([{ id: 'a' }], { settle: { lazyImages: true, afterSweep: 'header' } }), /afterSweep/);
  assert.throws(() => config([{ id: 'a', settleBySide: { local: { lazyImages: true, afterSweep: [1] } } }]), /afterSweep/);
});

test('an afterSweep change makes only its own target incompatible, and the diagnostic names it (R5.15, R8.16)', () => {
  const a = run(config([{ id: 'home', settle: { lazyImages: true } }, { id: 'about' }]));
  const b = run(config([{ id: 'home', settle: swept(['header:not(.scrolled)']) }, { id: 'about' }]));
  assert.equal(comparisonState(entry(a, 'home'), entry(b, 'home'), a, b), 'incompatible');
  assert.match(incompatibleDiagnostic(a, b, entry(a, 'home'), entry(b, 'home')), /settle\.afterSweep \(A: unset, B: \["header:not\(\.scrolled\)"\]\)/);
  assert.equal(comparisonState(entry(a, 'about'), entry(b, 'about'), a, b), 'complete');
  const c = run(config([{ id: 'home', settle: swept(['header:not(.scrolled)']) }, { id: 'about' }]));
  assert.equal(comparisonState(entry(b, 'home'), entry(c, 'home'), b, c), 'complete');
});

test('afterSweep does not change the capture engine version (R5.6, R5.15)', () => {
  assert.equal(CAPTURE_ENGINE_VERSION, 1);
  assert.equal(entry(run(config([{ id: 'home', settle: swept(['header']) }])), 'home').recipe.version, 1);
});

test('an old entry without settleHash does not match a recipe with afterSweep (R5.15)', () => {
  // Stored settings are untrusted and skip the cross-layer check, so the key alone must break the legacy match.
  const stored = afterSweep => ({ sides: { local: { origin: 'http://localhost:8080', settle: { afterSweep } } } });
  assert.equal(settlementMatches({}, stored([]), 'local', {}), true);
  assert.equal(settlementMatches({}, stored(['header']), 'local', {}), false);
});

test('a hidden afterSweep selector is not a transient failure (R5.14, R5.15)', () => {
  const error = Object.assign(new Error('The afterSweep selector "header" matches no visible element.'), { code: 'AFTER_SWEEP_NOT_VISIBLE' });
  assert.equal(isTransientFailure({ error, phase: 'settlement' }), false);
});
