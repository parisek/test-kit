import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUrl, isOwnOrigin, requestPolicy, userAgentOption, createRunId, assertImageBounds, targetPath, ddevMatchesOrigin } from '../../src/capture/helpers.js';

test('navigation guards reject remote redirects and credentials', () => {
  for (const value of ['http://localhost/path', 'https://example-site.ddev.site/path', 'http://127.0.0.2/', 'http://[::1]/']) assert.equal(isLocalUrl(value), true);
  for (const value of ['https://example.com/', 'http://localhost.example.com/', 'http://user:password@localhost/', 'file:///tmp/test', 'data:text/html,test', 'not a URL']) assert.equal(isLocalUrl(value), false);
});

test('run identity preserves timestamp, process and revision grammar', () => {
  assert.equal(createRunId(new Date('2026-10-09T10:20:30.123Z'), 123, 'abcdef123456'), '2026-10-09T10-20-30-123Z-123-abcdef123456');
  assert.throws(() => createRunId(new Date(), 1, '../unsafe'));
  assert.throws(() => createRunId(new Date('invalid'), 1, 'abcdef1'));
});

test('image bounds apply to physical pixels and long pages', () => {
  assert.doesNotThrow(() => assertImageBounds(1280, 1000, 2));
  for (const dimensions of [[1280, 30001, 1], [4096, 4096, 2], [1, Infinity, 1], [0, 100, 1]]) assert.throws(() => assertImageBounds(...dimensions));
});

test('per-side paths do not use inherited object properties', () => {
  assert.equal(targetPath({ path: '/', paths: { local: '/local' } }, 'local'), '/local');
  assert.equal(targetPath({ path: '/', paths: {} }, 'constructor'), '/');
});

test('DDEV checkout identity must match the configured host', () => {
  assert.equal(ddevMatchesOrigin({ raw: { primary_url: 'https://example-site.ddev.site' } }, 'http://example-site.ddev.site'), true);
  assert.equal(ddevMatchesOrigin({ raw: { httpsurl: 'https://other.ddev.site' } }, 'http://example-site.ddev.site'), false);
  assert.equal(ddevMatchesOrigin({ raw: { httpsurl: 'invalid' } }, 'http://example-site.ddev.site'), false);
  assert.equal(ddevMatchesOrigin({}, 'http://example-site.ddev.site'), false);
});

test('a remote side reads its own origin and drops every other origin', () => {
  const remote = { origin: 'https://example.com', remote: true };
  const policy = (url, method = 'GET', topLevel = false, side = remote) => requestPolicy({ url, method, topLevel, ...side });
  assert.equal(policy('https://example.com/page', 'GET', true), 'allow');
  assert.equal(policy('https://example.com/a.css'), 'allow');
  assert.equal(policy('https://example.com/a.css', 'HEAD'), 'allow');
  assert.equal(policy('https://example.com/submit', 'POST'), 'block');
  assert.equal(policy('https://tags.example.net/t.js'), 'drop');
  assert.equal(policy('https://tags.example.net/beacon', 'POST'), 'block');
  assert.equal(policy('https://tags.example.net/x', 'PUT', true), 'block');
  assert.equal(policy('https://other.example.org/', 'GET', true), 'block');
  assert.equal(policy('http://example.com/page'), 'drop');
  assert.equal(policy('http://127.0.0.1/', 'GET'), 'drop');
});

test('a local side keeps blocking every request that leaves the local environment', () => {
  const local = { origin: 'http://127.0.0.1:8080', remote: false };
  const policy = (url, method = 'GET') => requestPolicy({ url, method, topLevel: false, ...local });
  assert.equal(policy('http://127.0.0.1:8080/a.css'), 'allow');
  assert.equal(policy('https://example.com/a.js'), 'block');
  assert.equal(policy('http://127.0.0.1:8080/submit', 'POST'), 'block');
});

test('a remote side with challenge cloudflare allows only the challenge POST of its own origin (R3.5)', () => {
  const side = { origin: 'https://example.com', remote: true, challenge: 'cloudflare' };
  const policy = (url, method = 'POST', topLevel = false, options = side) => requestPolicy({ url, method, topLevel, ...options });
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/h/b/jsd/oneshot/x'), 'allow');
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/h/b/jsd/oneshot/d2d3316b729e/0.30357:1793088923:TGH'), 'allow');
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/h/b/jsd/oneshot/x', 'POST', true), 'block');
  assert.equal(requestPolicy({ url: 'https://example.com/cdn-cgi/challenge-platform/x', method: 'POST', topLevel: false, navigation: true, ...side }), 'block');
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/x?y'), 'allow');
  for (const path of ['..%2fsubmit', '%2e%2e/submit', 'x%5csubmit', 'x/', 'x//y', '', 'x/../../submit', 'x y', 'x!']) assert.equal(policy(`https://example.com/cdn-cgi/challenge-platform/${path}`), 'block', path);
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/x', 'PUT'), 'block');
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platformx'), 'block');
  assert.equal(policy('https://example.com/cdn-cgi/other/x'), 'block');
  assert.equal(policy('https://example.com/submit'), 'block');
  assert.equal(policy('https://other.example.net/cdn-cgi/challenge-platform/x'), 'block');
  assert.equal(policy('https://example.com/cdn-cgi/challenge-platform/x', 'POST', false, { origin: 'https://example.com', remote: true }), 'block');
  assert.equal(policy('http://localhost/cdn-cgi/challenge-platform/x', 'POST', false, { origin: 'http://localhost', remote: false, challenge: 'cloudflare' }), 'block');
});

test('own origin comparison rejects credentials, other ports and other schemes', () => {
  assert.equal(isOwnOrigin('https://example.com/a', 'https://example.com'), true);
  for (const value of ['https://user:x@example.com/', 'https://example.com:8443/', 'http://example.com/', 'https://example.com.evil.net/', 'not a URL', 'file:///tmp/x']) assert.equal(isOwnOrigin(value, 'https://example.com'), false);
});

test('only a remote side with userAgent changes the browser context (R3.4)', () => {
  assert.deepEqual(userAgentOption({ origin: 'https://example.com', remote: true, userAgent: 'example test-kit/1.0' }), { userAgent: 'example test-kit/1.0' });
  assert.deepEqual(userAgentOption({ origin: 'https://example.com', remote: true }), {});
  assert.deepEqual(userAgentOption({ origin: 'http://localhost', userAgent: 'example test-kit/1.0' }), {});
  assert.deepEqual(userAgentOption(Object.create({ remote: true, userAgent: 'inherited' })), {});
});
