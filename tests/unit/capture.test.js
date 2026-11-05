import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUrl, isOwnOrigin, requestPolicy, describeBlockedRequest, blockedRequestMessage, edgeStop, userAgentOption, createRunId, assertImageBounds, targetPath, ddevMatchesOrigin, ddevStatusProblem } from '../../src/capture/helpers.js';

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

test('a challenge mark, or a 403 or 429 on the page, is an edge stop (R3.6)', () => {
  assert.equal(edgeStop({ status: 403, headers: { 'cf-mitigated': 'challenge' }, main: true }), 'cf-mitigated: challenge');
  assert.equal(edgeStop({ status: 200, headers: { 'cf-mitigated': 'challenge' }, main: false }), 'cf-mitigated: challenge');
  assert.equal(edgeStop({ status: 403, headers: {}, main: true }), 'HTTP 403');
  assert.equal(edgeStop({ status: 429, headers: {}, main: true }), 'HTTP 429');
  for (const status of [200, 301, 404, 500, 503]) assert.equal(edgeStop({ status, headers: {}, main: true }), null, String(status));
  assert.equal(edgeStop({ status: 403, headers: {}, main: false }), null);
  assert.equal(edgeStop({ status: 429, headers: {}, main: false }), null);
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

test('the blocked-request message names method, origin, resource type and kind, never path or query (R3.7)', () => {
  const font = describeBlockedRequest({ url: 'https://fonts.example-site.com/a/b.woff2?token=secret#x', method: 'get', resourceType: 'font', topLevel: false, navigation: false });
  assert.deepEqual(font, { origin: 'https://fonts.example-site.com', method: 'GET', resourceType: 'font', kind: 'subresource', redirect: false });
  const text = blockedRequestMessage(font);
  assert.equal(text, 'A request leaves the local environment or submits data. First blocked request: GET https://fonts.example-site.com, font, subresource.');
  assert.doesNotMatch(text, /secret|woff2|\/a\/b/);
  assert.doesNotMatch(text, /navigation/);
});

test('the blocked-request message separates a top-level navigation, a frame and a redirect (R3.7)', () => {
  const top = describeBlockedRequest({ url: 'https://example.com/x', method: 'GET', resourceType: 'document', topLevel: true, navigation: true });
  assert.match(blockedRequestMessage(top), /GET https:\/\/example\.com, document, top-level navigation\.$/);
  const frame = describeBlockedRequest({ url: 'https://example.com/x', method: 'GET', resourceType: 'document', topLevel: false, navigation: true });
  assert.match(blockedRequestMessage(frame), /document, frame navigation\.$/);
  const post = describeBlockedRequest({ url: 'http://127.0.0.1/submit', method: 'POST', resourceType: 'xhr', topLevel: false, navigation: false });
  assert.match(blockedRequestMessage(post), /POST http:\/\/127\.0\.0\.1, xhr, subresource\.$/);
  const redirect = describeBlockedRequest({ url: 'https://example.com/y', method: 'GET', resourceType: 'image', topLevel: false, navigation: false, redirect: true });
  assert.match(blockedRequestMessage(redirect), /image, subresource, redirect target\.$/);
});

test('the blocked-request message treats page data as untrusted (R3.7)', () => {
  const bad = describeBlockedRequest({ url: 'not a url', method: 'GE\nT\u001b[31m', resourceType: 'x'.repeat(500), topLevel: false });
  const text = blockedRequestMessage(bad);
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f]/);
  assert.ok(text.length < 200);
  assert.match(text, /unknown origin/);
  assert.equal(blockedRequestMessage(null), 'A request leaves the local environment or submits data.');
});

test('ddevStatusProblem accepts a running project and names the fix for any other status (Principle 1)', () => {
  assert.equal(ddevStatusProblem({ raw: { status: 'running' } }), null);
  for (const status of ['stopped', 'paused', 'project directory missing']) {
    assert.match(ddevStatusProblem({ raw: { status } }), /^The DDEV project is not running \(status: .+\)\. Run ddev start\.$/);
  }
  for (const description of [{}, { raw: {} }, { raw: { status: 7 } }, { raw: { status: 'x\ny' } }, null]) {
    assert.equal(ddevStatusProblem(description), 'The DDEV project is not running. Run ddev start.');
  }
});
