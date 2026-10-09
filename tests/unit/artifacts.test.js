import test from 'node:test';
import assert from 'node:assert/strict';
import { lineWindow, boundedDifference } from '../../src/artifacts/diff.js';
import { artifactState } from '../../src/artifacts/state.js';
import { comparisonDetail } from '../../src/artifacts/schema.js';
import { cellClass, cellState, targetClass } from '../../src/report/classify.js';
import { summarizeReport } from '../../src/query/summary.js';
import { validateReport } from '../../src/report/model.js';
import { normalizeConfig } from '../../src/config/index.js';
import { parseCommand } from '../../src/cli/run.js';

test('linear HTML window counts omitted lines without hiding a byte change', () => {
  const diff = lineWindow('same\nold\nend', 'same\nnew\nend', { maxLines: 1 });
  assert.equal(diff.removedLines, 1); assert.equal(diff.addedLines, 1);
  assert.equal(diff.displayedLines, 1); assert.equal(diff.omittedLines, 1);
  assert.equal(lineWindow('x'.repeat(10000), 'y').lines[0].truncated, true);
  assert.deepEqual(comparisonDetail('html', { changed: true, ...diff, extra: 'omit' }), { changed: true, ...diff });
  assert.throws(() => comparisonDetail('html', { changed: true, ...diff, lines: [{ kind: 'added', line: 1, text: 'x'.repeat(2001), truncated: false }] }), /Invalid/);
});
test('artifact compatibility ignores unrelated capture artifacts', () => {
  const index = { state: 'captured', tool: 'playwright', version: '1', browserVersion: '2', settingsHash: 'sha256:x' };
  assert.equal(artifactState(index, { ...index, path: 'other' }), 'complete');
  assert.equal(artifactState(index, { ...index, browserVersion: '3' }), 'incompatible');
  assert.equal(artifactState(index, null), 'missing');
  assert.equal(artifactState(index, { ...index, state: 'failed' }), 'failed');
});
function data(artifacts) {
  for (const kind of ['html', 'status']) if (artifacts[kind]?.state === 'complete') {
    const index = { tool: 'example', version: '1', settingsHash: 'sha256:x' };
    artifacts[kind] = { ...artifacts[kind], a: { ...index, src: kind === 'html' ? 'a.txt' : 'a.json' },
      b: { ...index, src: kind === 'html' ? 'b.txt' : 'b.json' }, diff: { ...index, src: 'diff.json', changed: false } };
  }
  return { schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'wide' }] },
    runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
    entries: [{ id: 'home', viewports: [{ id: 'wide', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, artifacts }] }],
    findings: [], causes: [], rules: {} };
}
test('HTML failure cannot become match even when stored row claims complete', () => {
  const report = data({ screenshot: { state: 'complete' }, html: { state: 'failed' } });
  assert.equal(cellState(report.entries[0], 'wide'), 'failed');
  assert.equal(cellClass(report, report.entries[0], 'wide'), null);
  assert.equal(summarizeReport(report).verdict, 'incomplete');
});
test('status-only complete evidence stays unclassified and never claims match', () => {
  const report = data({ status: { state: 'complete' } });
  assert.equal(targetClass(report, report.entries[0]), null);
  assert.equal(summarizeReport(report).verdict, 'no-comparable-evidence');
  assert.equal(cellClass(data({}), data({}).entries[0], 'wide'), 'match');
});
test('target scoped HTML findings survive targets without rows', () => {
  const report = data({ html: { state: 'complete' } });
  report.entries[0].viewports = [];
  report.findings.push({ targetId: 'home', artifact: 'html' });
  assert.equal(targetClass(report, report.entries[0]), 'unexplained');
});
test('CLI scopes bounded artifact queries and explicit opt-in capture', () => {
  assert.deepEqual(parseCommand(['capture', '--side', 'a', '--artifacts', 'html,status']).options.artifacts, 'html,status');
  assert.equal(parseCommand(['query', 'report.json', '--target', 'home', '--viewport', 'wide', '--artifact', 'html', '--max-lines', '3']).options.maxLines, 3);
  assert.throws(() => parseCommand(['query', 'report.json', '--target', 'home']), /requires/);
  assert.throws(() => parseCommand(['query', 'report.json', '--target', 'home', '--viewport', 'wide', '--artifact', 'html', '--max-lines', '101']), /1..100/);
});

test('comparable HTML finding remains unexplained alongside a failed screenshot', () => {
  const report = data({ screenshot: { state: 'failed' }, html: { state: 'complete' } });
  report.findings.push({ targetId: 'home', viewportId: 'wide', artifact: 'html' });
  assert.equal(targetClass(report, report.entries[0]), 'unexplained');
  assert.equal(summarizeReport(report).verdict, 'incomplete');
});

test('bounded HTML line numbers include the terminal line at the body boundary', () => {
  const diff = lineWindow('\n'.repeat(2 * 1024 * 1024), '\n'.repeat(2 * 1024 * 1024 - 1) + 'x');
  assert.doesNotThrow(() => comparisonDetail('html', { changed: true, ...diff }));
});

test('complete empty artifact extensions cannot invent comparable evidence', () => {
  const legacy = data({});
  delete legacy.entries[0].viewports[0].ratio;
  assert.ok(validateReport(legacy).some(problem => problem.includes('ratio')));
  const html = data({ html: { state: 'complete' } });
  html.entries[0].viewports[0].artifacts.html = { state: 'complete', a: null, b: null, diff: null };
  assert.ok(validateReport(html).some(problem => problem.includes('indexed provenance')));
  assert.throws(() => summarizeReport(html), /Invalid report/);
});

test('oracle targets preserve parity for comparable screenshot and HTML findings', () => {
  for (const artifact of ['screenshot', 'html']) {
    const report = data({ [artifact]: { state: 'complete' } });
    report.entries[0].judge = 'oracle';
    report.findings.push({ targetId: 'home', viewportId: 'wide', artifact });
    assert.equal(cellClass(report, report.entries[0], 'wide'), 'oracle');
    assert.equal(targetClass(report, report.entries[0]), 'oracle');
  }
});

test('raw and normalized windows share the serialized sidecar budget', () => {
  const a = ('\u0001'.repeat(2000) + '\n').repeat(100), b = 'X\n'.repeat(100);
  const detail = boundedDifference({ changed: true, rawChanged: true, ...lineWindow(a, b), rawWindow: { changed: true, ...lineWindow(a, b) }, normalization: { policyHash: 'sha256:' + 'a'.repeat(64), rawA: 'sha256:' + 'a'.repeat(64), rawB: 'sha256:' + 'b'.repeat(64), fired: [], scoped: [], diagnostics: [] } });
  assert.ok(Buffer.byteLength(JSON.stringify(detail)) <= 2 * 1024 * 1024);
  for (const window of [detail, detail.rawWindow]) {
    assert.equal(window.displayedLines, window.lines.length);
    assert.equal(window.omittedLines, window.removedLines + window.addedLines - window.lines.length);
    assert.ok(window.omittedLines > 100);
  }
  assert.doesNotThrow(() => comparisonDetail('html', detail));
});
