import test from 'node:test';
import assert from 'node:assert/strict';
import { audited } from '../../src/perf/index.js';
import { comparisonSide } from '../../src/perf/compare-artifact.js';
import { hostResolverRules, blockedUrlPatterns, requestEvidence, mergeBlocked, finalOriginProblem } from '../../src/perf/isolation.js';

const sent = (requestId, url, type, method = 'GET') => ({ method: 'Network.requestWillBeSent', params: { requestId, type, request: { url, method } } });
const failed = (requestId, extra) => ({ method: 'Network.loadingFailed', params: { requestId, ...extra } });
const notFound = { errorText: 'net::ERR_NAME_NOT_RESOLVED' };

test('host rules pin a local own host and block every other host (R6.16, #383)', () => {
  assert.equal(hostResolverRules({ origin: 'https://example-site.ddev.site', address: '127.0.0.1' }),
    'MAP example-site.ddev.site 127.0.0.1, MAP * ~NOTFOUND');
  // An exclusion skips every MAP rule, so the local own host is never excluded.
  assert.equal(hostResolverRules({ origin: 'http://localhost:8080', address: '::1', allowOrigins: ['https://fonts.example.com', 'https://localhost'] }),
    'MAP localhost [::1], MAP * ~NOTFOUND, EXCLUDE fonts.example.com');
  assert.equal(hostResolverRules({ origin: 'https://example.com', allowOrigins: ['https://cdn.example.net'] }),
    'MAP * ~NOTFOUND, EXCLUDE cdn.example.net, EXCLUDE example.com');
  assert.equal(hostResolverRules({ origin: 'http://127.0.0.1:8080', address: '127.0.0.1' }), 'MAP 127.0.0.1 127.0.0.1, MAP * ~NOTFOUND');
  assert.throws(() => hostResolverRules({ origin: 'http://localhost', address: '127.0.0.1, MAP * 203.0.113.1' }));
});

test('block paths become Lighthouse URL patterns of the own origin', () => {
  assert.deepEqual(blockedUrlPatterns('https://example.com', ['/analytics/*', '/wp-json/hit']),
    ['https://example.com/analytics/*', 'https://example.com/wp-json/hit']);
  assert.deepEqual(blockedUrlPatterns('https://example.com'), []);
});

test('blocked requests are evidence by type and origin, with no path or query (R6.17)', () => {
  const origin = 'https://example.com';
  const evidence = requestEvidence([
    sent('1', 'https://example.com/', 'Document'),
    sent('2', 'https://www.googletagmanager.com/gtm.js?id=X-1', 'Script'), failed('2', notFound),
    sent('3', 'https://www.googletagmanager.com/other.js', 'Script'), failed('3', notFound),
    sent('4', 'https://example.com/analytics/hit?u=1', 'Fetch'), failed('4', { errorText: '', blockedReason: 'inspector' }),
    sent('5', 'https://fonts.example.net/a.woff2', 'Font'), failed('5', notFound),
    sent('6', 'data:text/plain,x', 'Other'),
    // A failure of the own origin is not a block: Lighthouse reports it.
    sent('7', 'https://example.com/missing.js', 'Script'), failed('7', notFound),
  ], { origin });
  assert.equal(evidence.violation, null);
  assert.deepEqual(evidence.blocked, [
    { resourceType: 'script', origin: 'https://www.googletagmanager.com', count: 2 },
    { resourceType: 'fetch', origin: 'https://example.com', count: 1 },
    { resourceType: 'font', origin: 'https://fonts.example.net', count: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /gtm\.js|analytics|X-1|u=1/);
  assert.equal(evidence.omitted, 0);
});

test('a write method, a WebSocket and a failed allowed origin are violations; a challenge POST is not', () => {
  const origin = 'https://example.com';
  assert.equal(requestEvidence([sent('1', 'https://example.com/track?x=1', 'Fetch', 'POST')], { origin }).violation, 'POST fetch request to https://example.com');
  assert.equal(requestEvidence([sent('1', 'https://other.example/', 'XHR', 'PUT')], { origin }).violation, 'PUT xhr request to https://other.example');
  assert.equal(requestEvidence([{ method: 'Network.webSocketCreated', params: { url: 'wss://example.com/socket' } }], { origin }).violation, 'WebSocket to wss://example.com');
  const allowed = { origin, allowOrigins: ['https://fonts.example.net'] };
  assert.equal(requestEvidence([sent('1', 'https://fonts.example.net/a.css', 'Stylesheet'), failed('1', { errorText: 'net::ERR_CERT_DATE_INVALID' })], allowed).violation,
    'An allowed origin failed: stylesheet request to https://fonts.example.net');
  assert.equal(requestEvidence([sent('1', 'https://fonts.example.net/a.css', 'Stylesheet'), failed('1', { errorText: 'net::ERR_ABORTED', canceled: true })], allowed).violation, null);
  const challenge = sent('1', 'https://example.com/cdn-cgi/challenge-platform/h/b/flow/ov1', 'XHR', 'POST');
  assert.equal(requestEvidence([challenge], { origin, challenge: 'cloudflare' }).violation, null);
  assert.match(requestEvidence([challenge], { origin }).violation, /^POST/);
  assert.match(requestEvidence([sent('1', 'https://example.com/cdn-cgi/challenge-platform/', 'XHR', 'POST')], { origin, challenge: 'cloudflare' }).violation, /^POST/);
  // R6.17: a write that Chrome blocked never reached a server, so it is evidence, not a violation.
  const post = sent('1', 'https://example.com/wp-admin/admin-ajax.php', 'XHR', 'POST');
  const byPath = requestEvidence([post, failed('1', { errorText: '', blockedReason: 'inspector' })], { origin });
  assert.equal(byPath.violation, null);
  assert.deepEqual(byPath.blocked, [{ resourceType: 'xhr', origin: 'https://example.com', count: 1 }]);
  assert.equal(requestEvidence([sent('1', 'https://other.example/beacon', 'Ping', 'POST'), failed('1', notFound)], { origin }).violation, null);
  // Another failure is no proof of a block: the request may have reached the server.
  assert.match(requestEvidence([post, failed('1', { errorText: 'net::ERR_CONNECTION_RESET' })], { origin }).violation, /^POST xhr/);
  // A redirect proves that the write was sent, even when its next hop is blocked.
  const redirected = { method: 'Network.requestWillBeSent', params: { requestId: '1', type: 'XHR', redirectResponse: { status: 307 }, request: { url: 'https://other.example/x', method: 'POST' } } };
  assert.equal(requestEvidence([post, redirected, failed('1', notFound)], { origin }).violation, 'POST xhr request to https://example.com');
  // The first violation in log order wins.
  assert.equal(requestEvidence([sent('1', 'https://example.com/a', 'Fetch', 'POST'), { method: 'Network.webSocketCreated', params: { url: 'wss://example.com/s' } }], { origin }).violation, 'POST fetch request to https://example.com');
  // A hostile method name never reaches the message as text.
  assert.equal(requestEvidence([sent('1', 'https://example.com/', 'Fetch', 'P\nOST')], { origin }).violation, 'A write method fetch request to https://example.com');
  assert.throws(() => requestEvidence(undefined, { origin }));
});

test('blocked groups stop at 50 and count the rest; merged audits add up', () => {
  const events = [];
  for (let index = 0; index < 52; index++) {
    events.push(sent(String(index), `https://host${index}.example/a.js`, 'Script'), failed(String(index), notFound));
  }
  const evidence = requestEvidence(events, { origin: 'https://example.com' });
  assert.equal(evidence.blocked.length, 50);
  assert.equal(evidence.omitted, 2);
  // The runner reads each audit without the cap, so a group outside the top 50 of one audit still sums.
  assert.equal(requestEvidence(events, { origin: 'https://example.com', limit: Infinity }).blocked.length, 52);
  const one = [{ resourceType: 'script', origin: 'https://a.example', count: 1 }];
  assert.deepEqual(mergeBlocked(mergeBlocked([], one), one), [{ resourceType: 'script', origin: 'https://a.example', count: 2 }]);
});

test('the page navigation must end on the own origin', () => {
  assert.equal(finalOriginProblem({ finalDisplayedUrl: 'https://example.com/page' }, 'https://example.com'), null);
  assert.equal(finalOriginProblem({ finalDisplayedUrl: 'https://cdn.example.net/' }, 'https://example.com'), 'The page navigation ended on https://cdn.example.net.');
  assert.equal(finalOriginProblem({}, 'https://example.com'), 'The final page URL is unavailable.');
});

test('the runner reads each audit without the cap; the detail side keeps the checked list (R6.17)', () => {
  const events = [];
  for (let index = 0; index < 52; index++) events.push(sent(String(index), `https://host${index}.example/a.js`, 'Script'), failed(String(index), notFound));
  const result = { lhr: { finalDisplayedUrl: 'https://example.com/' }, artifacts: { DevtoolsLog: events } };
  const evidence = audited(result, { origin: 'https://example.com', allowOrigins: [], blockPaths: [] });
  assert.equal(evidence.blocked.length, 52);
  assert.equal(evidence.omitted, 0);
  const side = comparisonSide({ settings: {}, metrics: {}, suspect: false, blocked: [{ resourceType: 'script', origin: 'https://a.example', count: 2 }, { resourceType: 'x', origin: 'file:///etc', count: 1 }], blockedOmitted: 3 });
  assert.deepEqual(side.blocked, [{ resourceType: 'script', origin: 'https://a.example', count: 2 }]);
  assert.equal(side.blockedOmitted, 4);
  assert.equal(Object.hasOwn(comparisonSide({ settings: {}, metrics: {}, suspect: false }), 'blocked'), false);
});
