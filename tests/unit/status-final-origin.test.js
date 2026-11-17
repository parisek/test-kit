import test from 'node:test';
import assert from 'node:assert/strict';
import { statusDetail, statusDifference } from '../../src/artifacts/schema.js';
import { finalOriginOf } from '../../src/artifacts/response.js';

const base = { statusCode: 404, finalPath: '/page/', redirects: ['/page/'], assets: { requests: 1, failed: 0, httpErrors: 0 } };

test('the status sidecar may name the final origin of a page that left its side (#348)', () => {
  assert.equal(statusDetail({ ...base, finalOrigin: 'http://127.0.0.1' }).finalOrigin, 'http://127.0.0.1');
  assert.equal(Object.hasOwn(statusDetail(base), 'finalOrigin'), false);
  for (const finalOrigin of ['http://127.0.0.1/', 'javascript:alert(1)', 'file:///etc', 'http://a\nb', 42, '', `https://${'a'.repeat(200)}.example`]) {
    assert.throws(() => statusDetail({ ...base, finalOrigin }), /Invalid HTTP status metadata/, String(finalOrigin));
  }
  // The final origin makes no finding: two sides have two origins (R6.13).
  assert.deepEqual(statusDifference(statusDetail({ ...base, finalOrigin: 'http://127.0.0.1' }), statusDetail(base)), []);
});

test('the final origin is recorded only when it differs and fits the sidecar (#348)', () => {
  assert.equal(finalOriginOf('http://127.0.0.1/page/', 'http://127.0.0.1:32768'), 'http://127.0.0.1');
  assert.equal(finalOriginOf('http://127.0.0.1:32768/page/', 'http://127.0.0.1:32768'), null);
  assert.equal(finalOriginOf('http://127.0.0.1/page/', null), null);
  assert.equal(finalOriginOf('data:text/html,x', 'http://127.0.0.1:32768'), null);
  const long = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.ddev.site`;
  assert.ok(long.length > 200);
  assert.equal(finalOriginOf(`${long}/page/`, 'http://127.0.0.1:32768'), null, 'a cut origin would fail statusDetail');
  for (const value of ['http://127.0.0.1', `https://${'a'.repeat(63)}.example`]) assert.equal(statusDetail({ ...base, finalOrigin: finalOriginOf(`${value}/x`, 'http://127.0.0.1:1') }).finalOrigin, value);
});
