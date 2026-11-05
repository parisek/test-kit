import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPolicy, isAllowedOriginRequest, redirectToAllowedOrigin } from '../../src/capture/helpers.js';
import { normalizeConfig, captureSettings, settingsHash } from '../../src/config/index.js';

const FONTS = 'https://use.example-site.net';
const allowOrigins = [{ origin: FONTS, types: ['stylesheet', 'font'] }];
const remote = { origin: 'https://example.com', remote: true, allowOrigins };
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

test('a subresource redirect may lead to an allowed origin, a navigation redirect never (R3.9)', () => {
  const base = { url: `${FONTS}/a.woff2`, resourceType: 'font', allowOrigins };
  assert.equal(redirectToAllowedOrigin({ ...base, navigation: false }), true);
  assert.equal(redirectToAllowedOrigin({ ...base, navigation: true }), false);
  assert.equal(redirectToAllowedOrigin({ ...base, navigation: false, resourceType: 'script' }), false);
  assert.equal(redirectToAllowedOrigin({ ...base, navigation: false, url: 'https://other.example-site.net/a' }), false);
});

test('a side without the list, or a local side, ignores it (R3.9)', () => {
  assert.equal(policy(`${FONTS}/a.woff2`, { allowOrigins: undefined }), 'drop');
  assert.equal(policy(`${FONTS}/a.woff2`, { allowOrigins: [] }), 'drop');
  assert.equal(requestPolicy({ url: `${FONTS}/a.woff2`, method: 'GET', topLevel: false, resourceType: 'font', origin: 'http://localhost:8080', remote: false, allowOrigins }), 'block');
  assert.equal(isAllowedOriginRequest({ url: `${FONTS}/a`, resourceType: 'font', allowOrigins: 'x' }), false);
  assert.equal(isAllowedOriginRequest({ url: `${FONTS}/a`, resourceType: 'font', allowOrigins: [null, { origin: FONTS }] }), false);
});

test('a remote side may set allowOrigins, and the config normalizes it (R3.9)', () => {
  const result = normalizeConfig(input({ allowOrigins: [{ origin: 'https://use.example-site.net/', types: ['script', 'font'] }] }));
  assert.deepEqual(result.sides.production.allowOrigins, [{ origin: FONTS, types: ['script', 'font'] }]);
  assert.equal(Object.hasOwn(result.sides.local, 'allowOrigins'), false);
  assert.equal(Object.hasOwn(normalizeConfig(input()).sides.production, 'allowOrigins'), false);
});

test('a local side refuses allowOrigins (R3.9)', () => {
  const source = input();
  source.sides.local.allowOrigins = allowOrigins;
  assert.throws(() => normalizeConfig(source), /allowOrigins requires remote true/);
  const flagged = input({ allowOrigins });
  flagged.sides.production.remote = false;
  assert.throws(() => normalizeConfig(flagged), /allowOrigins requires remote true/);
});

test('allowOrigins rejects anything but a short list of HTTPS origins and known types (R3.9)', () => {
  const bad = value => assert.throws(() => normalizeConfig(input({ allowOrigins: value })), /Invalid configuration/);
  bad([]); bad('https://use.example-site.net'); bad({}); bad(null);
  bad(Array.from({ length: 21 }, (_, index) => ({ origin: `https://h${index}.example-site.net`, types: ['font'] })));
  bad([{ origin: FONTS }]); bad([{ origin: FONTS, types: [] }]); bad([{ origin: FONTS, types: 'font' }]);
  bad([{ origin: FONTS, types: ['font', 'font'] }]);
  for (const type of ['document', 'xhr', 'fetch', 'websocket', 'other', 'Font', '*', '']) bad([{ origin: FONTS, types: [type] }]);
  for (const origin of ['http://use.example-site.net', 'use.example-site.net', '//use.example-site.net', 'https://use.example-site.net/path', 'https://use.example-site.net/?q=1',
    'https://use.example-site.net/#x', 'https://user:pass@use.example-site.net', 'file:///etc', 'javascript:alert(1)', '*', '', 5, null, 'https://use.example-site.net\n']) {
    bad([{ origin, types: ['font'] }]);
  }
  bad([{ origin: FONTS, types: ['font'] }, { origin: `${FONTS}/`, types: ['script'] }]);
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
