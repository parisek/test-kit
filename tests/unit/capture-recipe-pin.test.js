import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { CAPTURE_ENGINE_VERSION, captureRecipe, settingsHash, settlementMatches } from '../../src/config/settings.js';
import { normalizeConfig } from '../../src/config/normalize.js';

// #294 (R5.12, ADR 0008): settle.pin is a settle key, so it lives in recipe.settle.
const config = (targets, side = {}) => normalizeConfig({ schemaVersion: 1, viewports: [{ id: 'desktop', width: 800, height: 600 }],
  sides: { local: { origin: 'http://localhost:8080', ...side }, production: { origin: 'https://example-site.test', remote: true } },
  targets: targets.map(target => ({ kind: 'page', path: '/', ...target })) });
const run = (settings, side = 'local') => ({ side, settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }], captureSettings: { settle: settings.sides[side].settle }, settings });
const entry = (r, id) => {
  const recipe = captureRecipe(r.settings, r.side, r.settings.targets.find(target => target.id === id));
  return { targetId: id, state: 'captured', scopeHash: settingsHash(recipe.scope), settleHash: settingsHash(recipe.settle), recipe };
};
const settleOf = (settings, id, side = 'local') => captureRecipe(settings, side, settings.targets.find(target => target.id === id)).settle;

test('pin is off by default and recorded when set (R5.12)', () => {
  const settings = config([{ id: 'plain' }, { id: 'pinned', settle: { pin: ['header.sticky'] } }]);
  assert.equal(settleOf(settings, 'plain').pin, undefined);
  assert.deepEqual(settleOf(settings, 'pinned').pin, ['header.sticky']);
});

test('pin merges like other settle keys: arrays replace, [] clears, the side override wins (R5.8, R5.12)', () => {
  const settings = config([
    { id: 'inherit' },
    { id: 'replace', settle: { pin: ['.b'] } },
    { id: 'clear', settle: { pin: [] } },
    { id: 'by-side', settle: { pin: ['.b'] }, settleBySide: { local: { pin: ['.c', '.d'] } } },
  ], { settle: { pin: ['.a'] } });
  assert.deepEqual(settleOf(settings, 'inherit').pin, ['.a']);
  assert.deepEqual(settleOf(settings, 'replace').pin, ['.b']);
  assert.deepEqual(settleOf(settings, 'clear').pin, []);
  assert.deepEqual(settleOf(settings, 'by-side').pin, ['.c', '.d']);
  assert.deepEqual(settleOf(settings, 'by-side', 'production').pin, ['.b']);
});

test('a pin change makes only its own target incompatible, and the diagnostic names it (R5.12, R8.16)', () => {
  const a = run(config([{ id: 'home' }, { id: 'about' }]));
  const b = run(config([{ id: 'home', settle: { pin: ['header'] } }, { id: 'about' }]));
  assert.equal(comparisonState(entry(a, 'home'), entry(b, 'home'), a, b), 'incompatible');
  assert.match(incompatibleDiagnostic(a, b, entry(a, 'home'), entry(b, 'home')), /settle\.pin/);
  assert.equal(comparisonState(entry(a, 'about'), entry(b, 'about'), a, b), 'complete');
  const c = run(config([{ id: 'home', settle: { pin: ['header', 'nav'] } }, { id: 'about' }]));
  assert.equal(comparisonState(entry(b, 'home'), entry(c, 'home'), b, c), 'incompatible');
});

test('pin does not change the capture engine version (R5.6, R5.12)', () => {
  assert.equal(CAPTURE_ENGINE_VERSION, 1);
  const r = run(config([{ id: 'home', settle: { pin: ['header'] } }]));
  assert.equal(entry(r, 'home').recipe.version, 1);
});

test('an old entry without settleHash does not match a recipe with pin (R5.12)', () => {
  const settings = config([{ id: 'home', settle: { pin: ['header'] } }], {});
  assert.equal(settlementMatches({}, { ...settings, sides: { ...settings.sides, local: { ...settings.sides.local, settle: { ...settings.sides.local.settle, pin: ['header'] } } } }, 'local', {}), false);
});

test('pin accepts 1 to 20 bounded plain selectors and rejects the rest (R5.12)', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `.p${index}`);
  assert.equal(settleOf(config([{ id: 'a', settle: { pin: twenty } }]), 'a').pin.length, 20);
  assert.equal(settleOf(config([{ id: 'a', settle: { pin: ['x'.repeat(2048)] } }]), 'a').pin[0].length, 2048);
  for (const pin of [[...twenty, '.extra'], ['x'.repeat(2049)], [''], ['  '], ['a\nb'], [1], [null], 'header', {}, null, 1, [['header']]]) {
    assert.throws(() => config([{ id: 'a', settle: { pin } }]), /pin/, JSON.stringify(pin)?.slice(0, 40));
  }
  assert.throws(() => config([{ id: 'a' }], { settle: { pin: 'header' } }), /pin/);
  assert.throws(() => config([{ id: 'a', settleBySide: { local: { pin: [1] } } }]), /pin/);
});
