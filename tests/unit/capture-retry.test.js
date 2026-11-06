import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientFailure, TRANSIENT_NET_ERRORS, parseRetries, retryWait, navigationAbortCode, captureWithRetries, markTransient, deadlineError, chromiumNetError } from '../../src/capture/retry.js';
import { withWarning, sanitizeWarnings, captureWarningLines, CAPTURE_RETRIED } from '../../src/report/warnings.js';
import { parseCommand, dispatch } from '../../src/cli/run.js';

const net = name => Object.assign(new Error(`page.goto: net::${name} at http://example-site.test/`), { name: 'Error' });
const timeout = () => Object.assign(new Error('page.goto: Timeout 2500ms exceeded.'), { name: 'TimeoutError' });

test('the retry classifier accepts a Playwright timeout, the capture deadline and the listed network errors (R5.14)', () => {
  assert.equal(isTransientFailure({ error: timeout(), phase: 'navigation' }), true);
  assert.equal(isTransientFailure({ error: timeout(), phase: 'settlement' }), true);
  assert.equal(isTransientFailure({ error: deadlineError(), phase: 'screenshot' }), true);
  for (const name of TRANSIENT_NET_ERRORS) assert.equal(isTransientFailure({ error: net(name), phase: 'navigation' }), true, name);
  assert.deepEqual([...TRANSIENT_NET_ERRORS].sort(), ['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_TIMED_OUT', 'ERR_EMPTY_RESPONSE', 'ERR_NETWORK_CHANGED', 'ERR_TIMED_OUT']);
});

test('the retry classifier never accepts a refused connection, a DNS failure, a crash or an unknown error (R5.14)', () => {
  for (const name of ['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_FAILED', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_ABORTED', 'ERR_BLOCKED_BY_CLIENT', 'ERR_CONNECTION_RESET_X']) {
    assert.equal(isTransientFailure({ error: net(name), phase: 'navigation' }), false, name);
  }
  for (const message of ['page.goto: Target crashed', 'page.screenshot: Page crashed', 'Browser has been closed', 'Invalid screenshot PNG', 'Selector has no visible area']) {
    assert.equal(isTransientFailure({ error: new Error(message), phase: 'screenshot' }), false, message);
  }
  const pin = Object.assign(new Error('No match for pin'), { code: 'PIN_NO_MATCH' });
  assert.equal(isTransientFailure({ error: pin, phase: 'settlement' }), false);
  assert.equal(isTransientFailure({ error: new Error('Capture deadline exceeded'), phase: 'navigation' }), false, 'only the coded deadline counts');
  assert.equal(isTransientFailure({ phase: 'navigation' }), false);
  assert.equal(isTransientFailure({ error: 'net::ERR_TIMED_OUT', phase: 'navigation' }), false);
});

test('an edge stop, a block, an unexpected navigation or a 4xx or 5xx page wins over a transient message (R5.14, R3.6, R3.7, R3.9)', () => {
  const error = net('ERR_CONNECTION_RESET');
  assert.equal(isTransientFailure({ error, phase: 'navigation', edge: 'cloudflare challenge' }), false);
  assert.equal(isTransientFailure({ error, phase: 'navigation', blocked: true }), false);
  assert.equal(isTransientFailure({ error, phase: 'settlement', unexpectedNavigation: true }), false);
  for (const statusCode of [400, 403, 404, 429, 500, 503]) assert.equal(isTransientFailure({ error: timeout(), phase: 'screenshot', statusCode }), false, String(statusCode));
  assert.equal(isTransientFailure({ error: timeout(), phase: 'screenshot', statusCode: 200 }), true);
  assert.equal(isTransientFailure({ error: timeout(), phase: 'screenshot', statusCode: 301 }), true);
});

test('a failure in the content, behavior or packs phase is never retried (R5.14)', () => {
  for (const phase of ['content', 'behavior', 'packs', undefined, 'other']) assert.equal(isTransientFailure({ error: timeout(), phase }), false, String(phase));
});

test('chromiumNetError reads the name Playwright reports', () => {
  assert.equal(chromiumNetError(net('ERR_TIMED_OUT')), 'ERR_TIMED_OUT');
  assert.equal(chromiumNetError(new Error('no code here')), null);
  assert.equal(chromiumNetError(null), null);
});

test('a failed fetch of the page maps to the Chromium name only for a reset or a closed connection (R5.14)', () => {
  assert.equal(navigationAbortCode(new Error('route.fetch: socket hang up (ECONNRESET)')), 'connectionreset');
  assert.equal(navigationAbortCode(new Error('route.fetch: write EPIPE')), 'connectionreset');
  assert.equal(navigationAbortCode(new Error('route.fetch: aborted')), 'connectionclosed');
  for (const text of ['route.fetch: connect ECONNREFUSED 127.0.0.1:1', 'route.fetch: getaddrinfo ENOTFOUND x', 'route.fetch: Request timed out', 'other']) assert.equal(navigationAbortCode(new Error(text)), 'failed', text);
});

test('the retries value is an integer from 0 to 2 and defaults to 0 (R5.14)', () => {
  assert.equal(parseRetries(undefined), 0);
  assert.equal(parseRetries(0), 0);
  assert.equal(parseRetries('2'), 2);
  for (const bad of [-1, 3, 1.5, '3', 'x', '', NaN, '1.5', true]) assert.throws(() => parseRetries(bad), /--retries must be 0\.\.2/, String(bad));
});

test('the wait is 1000 ms times the attempt number, with no jitter (R5.14)', () => {
  assert.deepEqual([1, 2].map(retryWait), [1000, 2000]);
});

const failed = transient => markTransient({ targetId: 't', viewportId: 'v', state: 'failed', artifacts: {}, error: { code: 'CAPTURE_NAVIGATION_FAILED', message: 'The navigation step fails.' } }, transient);
const ok = { targetId: 't', viewportId: 'v', state: 'captured', path: 'screenshots/t/v.png' };

async function drive(results, retries) {
  const waits = [];
  let calls = 0;
  const entry = await captureWithRetries(async () => results[calls++], { retries, sleep: async ms => { waits.push(ms); }, addWarning: withWarning });
  return { entry, waits, calls };
}

test('with 0 retries a transient failure is not retried and the entry is unchanged (R5.1, R5.14)', async () => {
  const first = failed(true);
  const { entry, waits, calls } = await drive([first], 0);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(entry, first);
  assert.equal(entry.error.message, 'The navigation step fails.');
});

test('a first-try capture is returned as it is, with no warning (R5.14)', async () => {
  const { entry, calls } = await drive([ok], 2);
  assert.equal(calls, 1);
  assert.deepEqual(entry, ok);
});

test('a cell that succeeds on a retry gets CAPTURE_RETRIED with the retries used and waits 1000 ms times the attempt (R5.14)', async () => {
  const one = await drive([failed(true), ok], 2);
  assert.deepEqual(one.waits, [1000]);
  assert.deepEqual(one.entry.warnings, [{ code: CAPTURE_RETRIED, count: 1 }]);
  assert.equal(one.entry.state, 'captured');
  const two = await drive([failed(true), failed(true), ok], 2);
  assert.deepEqual(two.waits, [1000, 2000]);
  assert.deepEqual(two.entry.warnings, [{ code: CAPTURE_RETRIED, count: 2 }]);
});

test('the warning keeps the warnings that the capture already holds (R5.11, R5.14)', async () => {
  const lazy = { ...ok, warnings: [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 4 }] };
  const { entry } = await drive([failed(true), lazy], 1);
  assert.deepEqual(entry.warnings, [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 4 }, { code: CAPTURE_RETRIED, count: 1 }]);
  assert.deepEqual(sanitizeWarnings(entry.warnings), entry.warnings);
});

test('a cell that fails on its last attempt is failed and names the attempts (R5.14, R8.7)', async () => {
  const { entry, waits, calls } = await drive([failed(true), failed(true), failed(true)], 2);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(entry.state, 'failed');
  assert.match(entry.error.message, /The capture tried 3 times\.$/);
  assert.equal(entry.warnings, undefined);
});

test('a failure that is not transient stops at once, and the message names no attempts (R5.14)', async () => {
  const { entry, calls, waits } = await drive([failed(false), ok], 2);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  assert.equal(entry.error.message, 'The navigation step fails.');
});

test('a retry stops at the first failure that is not transient (R5.14)', async () => {
  const { entry, calls } = await drive([failed(true), failed(false), ok], 2);
  assert.equal(calls, 2);
  assert.match(entry.error.message, /The capture tried 2 times\.$/);
});

test('the transient mark never reaches run.json (R5.14)', () => {
  const entry = failed(true);
  assert.equal(entry.transient, true);
  assert.equal(JSON.stringify(entry).includes('transient'), false);
  assert.deepEqual(Object.keys(entry).includes('transient'), false);
});

test('the CAPTURE_RETRIED warning is a valid R5.11 warning and a stderr line starts with its code (R5.11, R5.14)', () => {
  const run = { captures: [{ warnings: [{ code: CAPTURE_RETRIED, count: 2 }] }, { warnings: [{ code: CAPTURE_RETRIED, count: 1 }] }, {}] };
  assert.deepEqual(captureWarningLines(run), ['Warning CAPTURE_RETRIED: 2 captures needed a retry (3 retries in all). The page may be flaky.']);
  assert.deepEqual(captureWarningLines({ captures: [{ warnings: [{ code: CAPTURE_RETRIED, count: 1 }] }] }), ['Warning CAPTURE_RETRIED: 1 capture needed a retry (1 retry in all). The page may be flaky.']);
  assert.deepEqual(captureWarningLines({ captures: [{}] }), []);
});

test('--retries parses as an integer from 0 to 2 and only on capture (R5.14, ADR 0009 answer 8)', () => {
  assert.equal(parseCommand(['capture', '--side', 'a', '--retries', '2']).options.retries, 2);
  assert.equal(parseCommand(['capture', '--side', 'a']).options.retries, undefined);
  for (const bad of ['3', '-1', 'x', '1.5']) assert.throws(() => parseCommand(['capture', '--side', 'a', '--retries', bad]), /--retries must be 0\.\.2|Missing value/, bad);
  for (const command of ['run', 'before', 'after']) assert.throws(() => parseCommand([command, '--retries', '1']), /Unknown option: --retries/);
});

test('the capture command passes retries and prints the retry line on stderr (R5.14)', async () => {
  let received;
  const run = { id: 'r', state: 'complete', captures: [{ warnings: [{ code: CAPTURE_RETRIED, count: 1 }] }] };
  const result = await dispatch(parseCommand(['capture', '--side', 'a', '--retries', '1', '--config', '/nonexistent/test-kit.config.json']), { capture: async args => { received = args; return { run, manifestPath: '/x/run.json' }; } });
  assert.equal(received.retries, 1);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stderr.some(line => line.startsWith('Warning CAPTURE_RETRIED:')), JSON.stringify(result));
});

test('the viewer text helpers show CAPTURE_RETRIED with no change (R5.11, R5.14)', async () => {
  const { warningTotals, cellWarningsText, captureWarningsSentence } = await import('../../src/report/warnings.js');
  const row = { warnings: { a: [{ code: CAPTURE_RETRIED, count: 2 }], b: [] } };
  assert.equal(cellWarningsText(row), 'A: CAPTURE_RETRIED (2) · B: none');
  const totals = warningTotals({ entries: [{ viewports: [row] }] });
  assert.deepEqual(totals, [{ code: CAPTURE_RETRIED, cells: 1, count: 2 }]);
  assert.equal(captureWarningsSentence(totals), 'Capture warnings: CAPTURE_RETRIED in 1 cell (2 in all).');
});
