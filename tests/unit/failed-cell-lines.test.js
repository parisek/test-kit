import test from 'node:test';
import assert from 'node:assert/strict';
import { failedCellLines, FAILURE_LINE_LIMIT } from '../../src/report/failures.js';

test('R5.16: a failed cell names target, viewport, code, status and final path', () => {
  const run = { captures: [
    { targetId: 'home', viewportId: 'desktop', state: 'captured', artifacts: {} },
    { targetId: 'news', viewportId: 'mobile', state: 'failed', statusCode: 404, finalPath: '/news/', error: { code: 'CAPTURE_NAVIGATION_FAILED', message: 'x' } },
  ] };
  assert.deepEqual(failedCellLines(run), ['test-kit: failed news at mobile: CAPTURE_NAVIGATION_FAILED (status 404, final path /news/)']);
});

test('R5.16: a captured cell with a failed artifact names the artifact', () => {
  const run = { captures: [{ targetId: 'home', viewportId: 'desktop', state: 'captured', statusCode: 200, finalPath: '/', artifacts: { screenshot: { state: 'captured' }, content: { state: 'failed', error: { code: 'CONTENT_CAPTURE_FAILED' } } } }] };
  assert.deepEqual(failedCellLines(run), ['test-kit: failed home at desktop: CONTENT_CAPTURE_FAILED (artifact content, status 200, final path /)']);
});

test('R5.16: a cell without status or path prints only the code', () => {
  const run = { captures: [{ targetId: 'home', viewportId: 'desktop', state: 'failed', error: { code: 'RUN_STOPPED' } }] };
  assert.deepEqual(failedCellLines(run), ['test-kit: failed home at desktop: RUN_STOPPED']);
});

test('R5.16: at most 20 lines, then one "and N more" line', () => {
  const captures = Array.from({ length: 23 }, (_, i) => ({ targetId: `t${i}`, viewportId: 'desktop', state: 'failed', error: { code: 'CAPTURE_SETTLEMENT_FAILED' } }));
  const lines = failedCellLines({ captures });
  assert.equal(lines.length, FAILURE_LINE_LIMIT + 1);
  assert.equal(lines.at(-1), 'test-kit: and 3 more failed cells. Read run.json for the rest.');
  assert.equal(failedCellLines({ captures: captures.slice(0, 21) }).at(-1), 'test-kit: and 1 more failed cell. Read run.json for the rest.');
});

test('R5.16: untrusted values of another shape stay out of the line', () => {
  const run = { captures: [{ targetId: 'home\u001b[2J', viewportId: '../x', state: 'failed', statusCode: 99999, finalPath: '/a b\u001b[31m', error: { code: 'bad code; rm' } }] };
  assert.deepEqual(failedCellLines(run), ['test-kit: failed unknown target at unknown viewport: UNKNOWN']);
  assert.deepEqual(failedCellLines({ captures: [{ state: 'failed', finalPath: 'relative/path', error: {} }] }), ['test-kit: failed unknown target at unknown viewport: UNKNOWN']);
  assert.deepEqual(failedCellLines({ captures: [{ targetId: 'home', viewportId: 'desktop', state: 'failed', finalPath: "/it's", error: { code: 'X' } }] }), ['test-kit: failed home at desktop: X']);
  assert.deepEqual(failedCellLines({ captures: [{ targetId: 'home', viewportId: 'desktop', state: 'captured', artifacts: { 'bad kind': { state: 'failed', error: { code: 'X' } } } }] }), ['test-kit: failed home at desktop: X']);
});

test('R5.16: no failure, no run or a bad captures field gives no line', () => {
  assert.deepEqual(failedCellLines({ captures: [{ targetId: 'home', viewportId: 'desktop', state: 'captured', artifacts: { screenshot: { state: 'captured' } } }] }), []);
  assert.deepEqual(failedCellLines(undefined), []);
  assert.deepEqual(failedCellLines({ captures: 'x' }), []);
  assert.deepEqual(failedCellLines({ captures: [null, 3, 'x'] }), []);
});

test('R5.16: capture prints the failed-cell lines on stderr; stdout stays one JSON line', async () => {
  const { run: runCli, dispatch } = await import('../../src/cli/run.js');
  const sink = () => ({ text: '', write(chunk) { this.text += chunk; } });
  const capture = async () => ({ run: { id: 'run-1', state: 'partial', captures: [
    { targetId: 'home', viewportId: 'desktop', state: 'captured', artifacts: {} },
    { targetId: 'news', viewportId: 'desktop', state: 'failed', statusCode: 500, finalPath: '/news', error: { code: 'CAPTURE_NAVIGATION_FAILED' } }] }, manifestPath: 'runs/run-1/run.json' });
  const out = sink();
  const err = sink();
  const code = await runCli(['capture', '--side', 'local'], { out, err }, '0.1.0', parsed => dispatch(parsed, { capture }));
  assert.equal(code, 1);
  assert.equal(out.text.trim().split('\n').length, 1);
  assert.equal(JSON.parse(out.text).state, 'partial');
  assert.match(err.text, /^test-kit: failed news at desktop: CAPTURE_NAVIGATION_FAILED \(status 500, final path \/news\)$/m);
});
