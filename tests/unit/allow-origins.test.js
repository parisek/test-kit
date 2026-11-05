import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPolicy, isAllowedOriginRequest, redirectToAllowedOrigin, redirectPermitted, ALLOW_ORIGIN_TYPES, isCertificateError, allowedOriginFailure, allowedOriginStatusFailure, describeBlockedRequest, blockedRequestMessage } from '../../src/capture/helpers.js';
import { comparisonState, incompatibleDiagnostic } from '../../src/compare/runs.js';
import { normalizeConfig, captureSettings, settingsHash } from '../../src/config/index.js';

const FONTS = 'https://use.example-site.net';
const allowOrigins = [{ origin: FONTS, types: ['stylesheet', 'font'] }];
const remote = { origin: 'https://example.com', remote: true, allowOrigins };
const localPolicy = (url, { method = 'GET', resourceType = 'font', navigation = false, ...rest } = {}) =>
  requestPolicy({ url, method, topLevel: navigation, navigation, resourceType, origin: 'http://localhost:8080', remote: false, allowOrigins, ...rest });
const policy = (url, { method = 'GET', topLevel = false, navigation = topLevel, resourceType = 'font', ...rest } = {}) =>
  requestPolicy({ url, method, topLevel, navigation, resourceType, ...remote, ...rest });

function input(sideExtra = {}) {
  return { schemaVersion: 1, sides: { production: { origin: 'https://example.com', remote: true, ...sideExtra }, local: { origin: 'http://localhost:8080' } },
    targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
}

test('a remote side reads a named origin for a named resource type with GET and HEAD (R3.9)', () => {
  assert.equal(policy(`${FONTS}/a.woff2`), 'allow');
  assert.equal(policy(`${FONTS}/a.woff2`, { method: 'HEAD' }), 'allow');
  assert.equal(policy(`${FONTS}/a.css`, { resourceType: 'stylesheet' }), 'allow');
});

test('a resource type outside the list of the origin is still aborted (R3.9)', () => {
  assert.equal(policy(`${FONTS}/a.js`, { resourceType: 'script' }), 'drop');
  assert.equal(policy(`${FONTS}/a.png`, { resourceType: 'image' }), 'drop');
  assert.equal(policy(`${FONTS}/x`, { resourceType: 'xhr' }), 'drop');
  assert.equal(policy(`${FONTS}/x`, { resourceType: null }), 'drop');
  assert.equal(policy(`${FONTS}/a.css`, { resourceType: 'stylesheet', allowOrigins: [{ origin: FONTS, types: ['font'] }] }), 'drop');
  assert.deepEqual([...ALLOW_ORIGIN_TYPES], ['stylesheet', 'font']);
});

test('a local side reads a named origin for a named type, and blocks everything else (R3.9)', () => {
  assert.equal(localPolicy(`${FONTS}/a.woff2`), 'allow');
  assert.equal(localPolicy(`${FONTS}/a.woff2`, { method: 'HEAD' }), 'allow');
  assert.equal(localPolicy('http://localhost:8080/a.css', { resourceType: 'stylesheet', allowOrigins: undefined }), 'allow');
  assert.equal(localPolicy(`${FONTS}/a.woff2`, { allowOrigins: undefined }), 'block');
  assert.equal(localPolicy(`${FONTS}/a.js`, { resourceType: 'script' }), 'block');
  assert.equal(localPolicy('https://other.example-site.net/a.woff2'), 'block');
  assert.equal(localPolicy(`${FONTS}/a.woff2`, { method: 'POST' }), 'block');
  assert.equal(localPolicy(`${FONTS}/`, { navigation: true, resourceType: 'document' }), 'block');
  assert.equal(localPolicy(`${FONTS}/`, { navigation: true, resourceType: 'font' }), 'block');
});

test('a write to an allowed origin still blocks, and the challenge rule does not reach it (R3.9)', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(policy(`${FONTS}/a`, { method }), 'block');
  assert.equal(policy(`${FONTS}/cdn-cgi/challenge-platform/h/x`, { method: 'POST', challenge: 'cloudflare' }), 'block');
});

test('a navigation to an allowed origin never passes (R3.9)', () => {
  assert.equal(policy(`${FONTS}/`, { topLevel: true, resourceType: 'document' }), 'block');
  assert.equal(policy(`${FONTS}/`, { navigation: true, resourceType: 'font' }), 'drop');
});

test('the origin must match exactly: scheme, host, port, credentials (R3.9)', () => {
  for (const url of ['http://use.example-site.net/a', 'https://use.example-site.net:8443/a', 'https://sub.use.example-site.net/a',
    'https://use.example-site.net.evil.net/a', 'https://user:x@use.example-site.net/a', 'https://evil.net/https://use.example-site.net/a', 'file:///a', 'not a url']) {
    assert.equal(policy(url), 'drop', url);
  }
});

test('a redirect from an allowed origin must end at an allowed origin for the type (R3.9)', () => {
  const two = [{ origin: FONTS, types: ['stylesheet', 'font'] }, { origin: 'https://files.example-site.net', types: ['font'] }];
  const base = { from: `${FONTS}/a.woff2`, resourceType: 'font', navigation: false, allowOrigins: two };
  assert.equal(redirectPermitted({ ...base, to: 'https://files.example-site.net/a.woff2', ownTarget: false }), true);
  assert.equal(redirectPermitted({ ...base, to: 'https://evil.example-site.net/a.woff2', ownTarget: false }), false);
  assert.equal(redirectPermitted({ ...base, to: 'https://files.example-site.net/a.css', resourceType: 'stylesheet', ownTarget: false }), false, 'the type must be listed for the target');
  assert.equal(redirectPermitted({ ...base, to: 'https://example.com/a.woff2', ownTarget: true }), false, 'the own origin is not on the list');
  assert.equal(redirectPermitted({ ...base, to: 'http://use.example-site.net/a.woff2', ownTarget: false }), false, 'a downgrade to HTTP is another origin');
  // A redirect from the own origin keeps its rule, and may also reach a listed origin.
  assert.equal(redirectPermitted({ ...base, from: 'https://example.com/a.css', to: 'https://example.com/b.css', ownTarget: true }), true);
  assert.equal(redirectPermitted({ ...base, from: 'https://example.com/a.css', to: `${FONTS}/a.woff2`, ownTarget: false }), true);
  assert.equal(redirectPermitted({ ...base, from: 'https://example.com/a.css', to: 'https://evil.example-site.net/a', ownTarget: false }), false);
  assert.equal(redirectToAllowedOrigin({ url: `${FONTS}/a.woff2`, navigation: true, resourceType: 'font', allowOrigins }), false);
});

test('both sides accept allowOrigins, and the config normalizes it (R3.9)', () => {
  const entry = [{ origin: 'https://use.example-site.net/', types: ['stylesheet', 'font'] }];
  const result = normalizeConfig(input({ allowOrigins: entry }));
  assert.deepEqual(result.sides.production.allowOrigins, [{ origin: FONTS, types: ['stylesheet', 'font'] }]);
  assert.equal(Object.hasOwn(result.sides.local, 'allowOrigins'), false);
  assert.equal(Object.hasOwn(normalizeConfig(input()).sides.production, 'allowOrigins'), false);
  const source = input();
  source.sides.local.allowOrigins = entry;
  assert.deepEqual(normalizeConfig(source).sides.local.allowOrigins, [{ origin: FONTS, types: ['stylesheet', 'font'] }]);
});

test('allowOrigins rejects anything but a short list of HTTPS origins and known types (R3.9)', () => {
  const bad = value => assert.throws(() => normalizeConfig(input({ allowOrigins: value })), /Invalid configuration/);
  bad([]); bad('https://use.example-site.net'); bad({}); bad(null);
  bad(Array.from({ length: 21 }, (_, index) => ({ origin: `https://h${index}.example-site.net`, types: ['font'] })));
  bad([{ origin: FONTS }]); bad([{ origin: FONTS, types: [] }]); bad([{ origin: FONTS, types: 'font' }]);
  bad([{ origin: FONTS, types: ['font', 'font'] }]);
  for (const type of ['script', 'image', 'media', 'document', 'xhr', 'fetch', 'websocket', 'other', 'Font', '*', '']) bad([{ origin: FONTS, types: [type] }]);
  for (const origin of ['http://use.example-site.net', 'use.example-site.net', '//use.example-site.net', 'https://use.example-site.net/path', 'https://use.example-site.net/?q=1',
    'https://use.example-site.net/#x', 'https://*.example-site.net', 'https://*', 'https://use.example-site.net:*', 'https://user:pass@use.example-site.net', 'file:///etc', 'javascript:alert(1)', '*', '', 5, null, 'https://use.example-site.net\n']) {
    bad([{ origin, types: ['font'] }]);
  }
  bad([{ origin: FONTS, types: ['font'] }, { origin: `${FONTS}/`, types: ['stylesheet'] }]);
  bad([{ origin: FONTS, types: ['font'], extra: true }]);
  bad([null]); bad([FONTS]);
  const holes = [, { origin: FONTS, types: ['font'] }]; // eslint-disable-line no-sparse-arrays
  bad(holes);
});

test('allowOrigins enters the capture settings hash and the order does not matter (R3.9)', () => {
  const plain = normalizeConfig(input());
  const one = normalizeConfig(input({ allowOrigins: [{ origin: FONTS, types: ['font', 'stylesheet'] }] }));
  const other = normalizeConfig(input({ allowOrigins: [{ origin: FONTS, types: ['font'] }] }));
  const hash = (config, side = 'production') => settingsHash(captureSettings(config, side));
  assert.notEqual(hash(one), hash(plain));
  assert.notEqual(hash(one), hash(other));
  assert.equal(hash(one), hash(normalizeConfig(input({ allowOrigins: [{ origin: FONTS, types: ['stylesheet', 'font'] }] }))));
  const two = [{ origin: FONTS, types: ['font'] }, { origin: 'https://fonts.example-site.net', types: ['stylesheet'] }];
  assert.equal(hash(normalizeConfig(input({ allowOrigins: two }))), hash(normalizeConfig(input({ allowOrigins: [...two].reverse() }))));
  // A side without the key keeps its hash, so an existing run stays comparable.
  assert.deepEqual(Object.keys(captureSettings(plain, 'production')), ['viewports', 'settle', 'screenshot']);
  assert.equal(hash(one, 'local'), hash(plain, 'local'));
});

test('a pair with a list on one side only is incompatible and the diagnostic names allowOrigins (R3.9)', () => {
  const run = (config, side) => ({ side, settingsHash: settingsHash(captureSettings(config, side)), captureSettings: captureSettings(config, side), tools: [{ name: 'playwright', version: '1', settingsHash: 'x' }] });
  const listed = normalizeConfig({ ...input(), sides: { production: { origin: 'https://example.com', remote: true, allowOrigins }, local: { origin: 'http://localhost:8080', allowOrigins } } });
  const plain = normalizeConfig(input());
  const captured = { state: 'captured' };
  const withList = run(listed, 'local');
  assert.equal(comparisonState(captured, captured, withList, run(plain, 'local')), 'incompatible');
  assert.match(incompatibleDiagnostic(withList, run(plain, 'local')), /allowOrigins/);
  assert.match(incompatibleDiagnostic(run(plain, 'local'), withList), /allowOrigins/);
  // The same list on a local and a remote side gives the same settings hash: the pair stays comparable.
  assert.equal(run(listed, 'local').settingsHash, run(listed, 'production').settingsHash);
  assert.doesNotMatch(incompatibleDiagnostic(run(plain, 'local'), run(plain, 'production')), /allowOrigins/);
});

test('any failed fetch of an allowed origin fails the capture and the message names origin, type and class (R3.9)', () => {
  assert.equal(isCertificateError(new Error('apiRequestContext.fetch: self-signed certificate')), true);
  assert.equal(isCertificateError(new Error('connect ECONNREFUSED')), false);
  const fail = (error, extra = {}) => allowedOriginFailure({ url: `${FONTS}/a.css?x=1`, method: 'GET', resourceType: 'stylesheet', allowOrigins, error, ...extra });
  for (const [error, label] of [['self-signed certificate', 'certificate'], ['connect ECONNREFUSED', 'request failed'], ['socket hang up', 'request failed'], ['getaddrinfo ENOTFOUND', 'request failed'], ['timeout of 5000ms exceeded', 'request failed'], ['something new', 'request failed']]) {
    const blocked = fail(new Error(error));
    assert.ok(blocked, error);
    const text = blockedRequestMessage(blocked);
    assert.ok(text.includes(`(${label})`) && text.includes(FONTS) && text.includes('stylesheet'), text);
    assert.ok(!text.includes('a.css') && !text.includes('x=1'));
  }
  assert.equal(fail(new Error('boom'), { url: 'https://other.example-site.net/a.css' }), null, 'an origin that is not allowed keeps its rule');
  assert.equal(fail(new Error('boom'), { resourceType: 'script' }), null);
});

test('an HTTP error answer of an allowed origin fails the capture and the message names the status (R3.9)', () => {
  const check = (status, extra = {}) => allowedOriginStatusFailure({ url: `${FONTS}/f.woff2?x=1`, method: 'GET', resourceType: 'font', allowOrigins, status, ...extra });
  for (const status of [400, 403, 404, 410, 500, 503]) {
    const text = blockedRequestMessage(check(status));
    assert.ok(text.includes(`(HTTP ${status})`) && text.includes(FONTS) && text.includes('font'), text);
    assert.ok(!text.includes('f.woff2') && !text.includes('x=1'));
  }
  for (const status of [200, 204, 206, 301, 302, 304, 307]) assert.equal(check(status), null, String(status));
  assert.equal(check(404, { url: 'https://other.example-site.net/f.woff2' }), null, 'an origin that is not allowed keeps its rule');
  assert.equal(check(404, { resourceType: 'script' }), null);
});
