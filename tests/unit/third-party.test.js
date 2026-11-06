import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPolicy, decideRequest, createDroppedLog, droppedFields } from '../../src/capture/helpers.js';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { normalizeConfig, captureSettings, settingsHash } from '../../src/config/index.js';

const EMBED = 'https://embed.example-site.net/player';
const local = (url, { method = 'GET', navigation = false, topLevel = navigation, thirdParty, resourceType = 'document' } = {}) =>
  requestPolicy({ url, method, topLevel, navigation, resourceType, origin: 'http://localhost:8080', remote: false, thirdParty });
const remote = (url, { method = 'GET', navigation = false, topLevel = navigation, thirdParty, resourceType = 'document' } = {}) =>
  requestPolicy({ url, method, topLevel, navigation, resourceType, origin: 'https://example.com', remote: true, thirdParty });

function input(production = {}, localSide = {}) {
  return { schemaVersion: 1, sides: { production: { origin: 'https://example.com', remote: true, ...production }, local: { origin: 'http://localhost:8080', ...localSide } },
    targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
}

test('a local side blocks a third-party GET by default and drops it with thirdParty "drop" (R3.10)', () => {
  assert.equal(local(EMBED, { navigation: true }), 'block');
  assert.equal(local(EMBED), 'block');
  assert.equal(local(EMBED, { thirdParty: 'block' }), 'block');
  assert.equal(local(EMBED, { thirdParty: 'drop', navigation: true, topLevel: false }), 'drop', 'a frame');
  assert.equal(local(EMBED, { thirdParty: 'drop', resourceType: 'script' }), 'drop', 'a subresource');
  assert.equal(local(EMBED, { thirdParty: 'drop', method: 'HEAD' }), 'drop');
  assert.equal(local('http://localhost:8080/a.css', { thirdParty: 'drop' }), 'allow');
});

test('a top-level navigation and every write still block with thirdParty "drop" (R3.10)', () => {
  assert.equal(local(EMBED, { thirdParty: 'drop', navigation: true, topLevel: true }), 'block');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal(local(EMBED, { thirdParty: 'drop', method }), 'block');
    assert.equal(local('http://localhost:8080/x', { thirdParty: 'drop', method }), 'block');
    assert.equal(remote(EMBED, { thirdParty: 'drop', method }), 'block');
  }
  assert.equal(remote(EMBED, { thirdParty: 'drop', navigation: true, topLevel: true }), 'block');
});

test('a remote side drops by default, and thirdParty "block" fails the capture instead (R3.10)', () => {
  assert.equal(remote(EMBED), 'drop');
  assert.equal(remote(EMBED, { thirdParty: 'drop' }), 'drop');
  assert.equal(remote(EMBED, { thirdParty: 'block' }), 'block');
  assert.equal(remote('https://example.com/a.css', { thirdParty: 'block' }), 'allow');
});

test('a dropped request of a local side enters the dropped record (R3.8, R3.10)', () => {
  const log = createDroppedLog();
  const args = { url: `${EMBED}?secret=1`, method: 'GET', topLevel: false, navigation: true, resourceType: 'document', origin: 'http://localhost:8080', remote: false };
  assert.equal(decideRequest(log, { ...args, thirdParty: 'drop' }), 'drop');
  assert.deepEqual(droppedFields(log), { dropped: [{ resourceType: 'document', origin: 'https://embed.example-site.net', count: 1 }] });
  const blocked = createDroppedLog();
  assert.equal(decideRequest(blocked, args), 'block');
  assert.deepEqual(droppedFields(blocked), {});
});

test('both sides accept thirdParty, and only "block" and "drop" are valid (R3.10)', () => {
  const both = normalizeConfig(input({ thirdParty: 'drop' }, { thirdParty: 'drop' }));
  assert.equal(both.sides.production.thirdParty, 'drop');
  assert.equal(both.sides.local.thirdParty, 'drop');
  assert.equal(Object.hasOwn(normalizeConfig(input()).sides.local, 'thirdParty'), false);
  for (const value of ['allow', 'DROP', true, null, '', 1, []]) {
    assert.throws(() => normalizeConfig(input({}, { thirdParty: value })), /Invalid configuration/);
    assert.throws(() => normalizeConfig(input({ thirdParty: value })), /Invalid configuration/);
  }
});

test('thirdParty enters the capture settings hash when set, and equal values give equal hashes (R3.10)', () => {
  const hash = (config, side) => settingsHash(captureSettings(config, side));
  const plain = normalizeConfig(input());
  const both = normalizeConfig(input({ thirdParty: 'drop' }, { thirdParty: 'drop' }));
  assert.equal(Object.hasOwn(captureSettings(plain, 'local'), 'thirdParty'), false, 'unset keeps the old hash');
  assert.notEqual(hash(both, 'local'), hash(plain, 'local'));
  assert.equal(hash(both, 'local'), hash(both, 'production'));
  const block = normalizeConfig(input({ thirdParty: 'block' }, { thirdParty: 'block' }));
  assert.notEqual(hash(block, 'local'), hash(both, 'local'));
});

test('thirdParty applies to a non-local origin only: another loopback or DDEV host stays allowed (R3.10)', () => {
  for (const thirdParty of [undefined, 'drop', 'block']) {
    assert.equal(local('http://127.0.0.1:9090/x', { thirdParty, resourceType: 'script' }), 'allow');
    assert.equal(local('http://localhost:9090/x', { thirdParty, resourceType: 'script' }), 'allow');
    assert.equal(local('https://example-site.ddev.site/x', { thirdParty, resourceType: 'script' }), 'allow');
  }
  assert.equal(requestPolicy({ url: 'http://127.0.0.1:9090/x', method: 'GET', topLevel: false, navigation: false, resourceType: 'script', origin: 'http://127.0.0.1:8080', remote: false, thirdParty: 'drop' }), 'allow');
});

test('a pair with different thirdParty values is incompatible and the diagnostic names thirdParty (R3.10)', () => {
  const run = (config, side) => ({ side, settingsHash: settingsHash(captureSettings(config, side)), captureSettings: captureSettings(config, side), tools: [{ name: 'playwright', version: '1', settingsHash: 'x' }] });
  const mixed = normalizeConfig(input({}, { thirdParty: 'drop' }));
  const captured = { state: 'captured' };
  assert.equal(comparisonState(captured, captured, run(mixed, 'local'), run(mixed, 'production')), 'incompatible');
  assert.match(incompatibleDiagnostic(run(mixed, 'local'), run(mixed, 'production')), /thirdParty \(A: "drop", B: unset\)/);
  const even = normalizeConfig(input({ thirdParty: 'drop' }, { thirdParty: 'drop' }));
  assert.equal(comparisonState(captured, captured, run(even, 'local'), run(even, 'production')), 'complete');
});
