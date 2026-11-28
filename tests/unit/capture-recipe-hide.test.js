import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRecipe, contentSettings, layoutSettings, settingsHash, settlementMatches } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';
import { hideStyle } from '../../src/capture/hide.js';

// R5.21: settle.hide is a settle key, so it lives in recipe.settle (R5.6) and merges like the masks (R5.8).
const config = (targets, side = {}) => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080', ...side }, production: { origin: 'https://example-site.test', remote: true } },
  targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const targetOf = (settings, id) => settings.targets.find(target => target.id === id);
const settleOf = (settings, id, side = 'local') => captureRecipe(settings, side, targetOf(settings, id)).settle;

test('hide is off by default and recorded when set (R5.21, R5.6)', () => {
  const settings = config([{ id: 'plain' }, { id: 'hides', settle: { hide: ['.skip-link'] } }]);
  assert.equal(Object.hasOwn(settleOf(settings, 'plain'), 'hide'), false);
  assert.deepEqual(settleOf(settings, 'hides').hide, ['.skip-link']);
});

test('an unset hide keeps the settle hash of the recipe without the key (R5.21, R8.16)', () => {
  const before = settingsHash(settleOf(config([{ id: 'home' }]), 'home'));
  assert.equal(before, settingsHash({ waitMs: 0, selectors: [], disableMotion: true, masks: [] }));
  assert.notEqual(settingsHash(settleOf(config([{ id: 'home', settle: { hide: ['.skip-link'] } }]), 'home')), before);
});

test('hide merges like other settle keys: arrays replace, [] clears, the side override wins (R5.8, R5.21)', () => {
  const settings = config([
    { id: 'inherit' },
    { id: 'replace', settle: { hide: ['.b'] } },
    { id: 'clear', settle: { hide: [] } },
    { id: 'by-side', settle: { hide: ['.b'] }, settleBySide: { local: { hide: ['.c', '.d'] } } },
  ], { settle: { hide: ['.a'] } });
  assert.deepEqual(settleOf(settings, 'inherit').hide, ['.a']);
  assert.deepEqual(settleOf(settings, 'replace').hide, ['.b']);
  assert.deepEqual(settleOf(settings, 'clear').hide, []);
  assert.deepEqual(settleOf(settings, 'by-side').hide, ['.c', '.d']);
  assert.equal(Object.hasOwn(settleOf(settings, 'inherit', 'production'), 'hide'), false);
});

test('hide refuses a brace, more than 50 selectors, a long or empty selector and a non-list (R5.21)', () => {
  assert.throws(() => config([{ id: 'home', settle: { hide: ['a { color: red } b'] } }]), /hide selector must not hold \{ or \}/);
  assert.throws(() => config([{ id: 'home', settle: { hide: ['a}'] } }]), /must not hold/);
  assert.throws(() => config([{ id: 'home', settle: { hide: Array.from({ length: 51 }, (_, i) => `.x${i}`) } }]));
  assert.throws(() => config([{ id: 'home', settle: { hide: ['.' + 'a'.repeat(1000)] } }]));
  assert.throws(() => config([{ id: 'home', settle: { hide: [''] } }]));
  assert.throws(() => config([{ id: 'home', settle: { hide: '.skip-link' } }]));
  assert.doesNotThrow(() => config([{ id: 'home', settle: { hide: Array.from({ length: 50 }, (_, i) => `.x${i}`) } }]));
  assert.doesNotThrow(() => config([{ id: 'home', settle: { hide: ['a.skip-link, .toast:not(.open)', '[data-x="\\7d"]'] } }]));
});

test('the content and layout settings leave hide out, like the masks (R5.21, R6.14)', () => {
  const plain = config([{ id: 'home' }]);
  const hiding = config([{ id: 'home', settle: { hide: ['.skip-link'] } }]);
  assert.equal(settingsHash(contentSettings(hiding, 'local', targetOf(hiding, 'home'))), settingsHash(contentSettings(plain, 'local', targetOf(plain, 'home'))));
  assert.equal(settingsHash(layoutSettings(hiding, 'local', targetOf(hiding, 'home'), '1')), settingsHash(layoutSettings(plain, 'local', targetOf(plain, 'home'), '1')));
});

test('an entry with no settle hash does not match a recipe with a non-empty hide (R5.21, R8.16)', () => {
  const side = config([{ id: 'home' }], { settle: { hide: ['.skip-link'] } });
  assert.equal(settlementMatches({ targetId: 'home' }, side, 'local', targetOf(side, 'home')), false);
  const cleared = config([{ id: 'home' }], { settle: { hide: [] } });
  assert.equal(settlementMatches({ targetId: 'home' }, cleared, 'local', targetOf(cleared, 'home')), true);
});

test('hideStyle gives one visibility rule for each selector and refuses a brace (R5.21, R4.4)', () => {
  assert.equal(hideStyle(['.skip-link', 'a, b']), '.skip-link { visibility: hidden !important; }\na, b { visibility: hidden !important; }');
  assert.equal(hideStyle([]), '');
  assert.equal(hideStyle(undefined), '');
  assert.throws(() => hideStyle(['a } body { display: none']), /Invalid hide selector/);
  assert.throws(() => hideStyle([42]), /Invalid hide selector/);
});
