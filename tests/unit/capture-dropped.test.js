import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns } from '../../src/compare/runs.js';
import { requestPolicy, decideRequest, createDroppedLog, recordDropped, droppedFields, DROPPED_LIMIT } from '../../src/capture/helpers.js';
import { droppedForRow, droppedNotListed } from '../../src/report/dropped.js';
import { summarizeReport } from '../../src/query/summary.js';

const report = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, causes: [], findings: [], entries: [] });
const row = dropped => ({ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, ...(dropped ? { dropped } : {}) });

test('the dropped log counts per resource type and origin, never a path or query (R3.8)', () => {
  const log = createDroppedLog();
  assert.deepEqual(droppedFields(log), {});
  recordDropped(log, { url: 'https://use.example-site.net/a/b.woff2?token=secret#x', resourceType: 'font' });
  recordDropped(log, { url: 'https://use.example-site.net/c.woff2', resourceType: 'font' });
  recordDropped(log, { url: 'https://use.example-site.net/d.css', resourceType: 'stylesheet' });
  assert.deepEqual(droppedFields(log), { dropped: [
    { resourceType: 'font', origin: 'https://use.example-site.net', count: 2 },
    { resourceType: 'stylesheet', origin: 'https://use.example-site.net', count: 1 },
  ] });
  assert.doesNotMatch(JSON.stringify(droppedFields(log)), /secret|woff2|token/);
});

test('the dropped log bounds its list and cleans page values (R3.8)', () => {
  const log = createDroppedLog();
  for (let index = 0; index < DROPPED_LIMIT + 5; index += 1) recordDropped(log, { url: `https://h${index}.example-site.net/x`, resourceType: 'image' });
  recordDropped(log, { url: 'https://h0.example-site.net/y', resourceType: 'image' });
  const fields = droppedFields(log);
  assert.equal(fields.dropped.length, DROPPED_LIMIT);
  assert.equal(fields.droppedOmitted, 5);
  assert.equal(fields.dropped.find(item => item.origin === 'https://h0.example-site.net').count, 2);
  const bad = createDroppedLog();
  recordDropped(bad, { url: 'not a url', resourceType: 'fo\nnt\u001b[31m' });
  assert.doesNotMatch(JSON.stringify(droppedFields(bad)), /[\u0000-\u001f\u007f]/);
});

test('the dropped log skips data, blob and other non-http(s) requests and keeps their slots free (R3.8)', () => {
  const log = createDroppedLog();
  recordDropped(log, { url: 'data:image/png;base64,AAAA', resourceType: 'image' });
  recordDropped(log, { url: 'blob:https://example-site.net/1234', resourceType: 'image' });
  recordDropped(log, { url: 'ftp://example-site.net/a', resourceType: 'font' });
  recordDropped(log, { url: 'not a url', resourceType: 'font' });
  assert.deepEqual(droppedFields(log), {});
  for (let index = 0; index < DROPPED_LIMIT; index += 1) recordDropped(log, { url: `data:text/plain,${index}`, resourceType: 'image' });
  recordDropped(log, { url: 'https://use.example-site.net/a.woff2', resourceType: 'font' });
  assert.deepEqual(droppedFields(log), { dropped: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 1 }] });
});

test('the request policy drops a read of another origin on a remote side and blocks a write (R3.8)', () => {
  const base = { origin: 'https://example.com', remote: true, topLevel: false, navigation: false };
  assert.equal(requestPolicy({ ...base, url: 'https://use.example-site.net/a.woff2', method: 'GET' }), 'drop');
  assert.equal(requestPolicy({ ...base, url: 'https://use.example-site.net/a', method: 'POST' }), 'block');
});

test('droppedForRow carries only well-formed records and stays absent without any (R3.8)', () => {
  assert.equal(droppedForRow({ state: 'captured' }, { state: 'captured' }), null);
  assert.equal(droppedForRow({ dropped: [{ resourceType: 'font', origin: 'file:///etc', count: 1 }] }, undefined), null);
  const font = { resourceType: 'font', origin: 'https://use.example-site.net', count: 2 };
  assert.deepEqual(droppedForRow({ dropped: [font, { ...font, extra: 'x' }] }, undefined), { a: [font, font], b: [] });
});

test('summary warns when a font or a stylesheet request was aborted, and ignores other types (R3.8)', () => {
  const data = report();
  data.entries = [
    { id: 'home', viewports: [row({
      a: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 3 }, { resourceType: 'image', origin: 'https://img.example-site.net', count: 9 }],
      b: [],
    })] },
    { id: 'about', viewports: [row()] },
  ];
  const summary = summarizeReport(data);
  assert.equal(summary.droppedRequestCount, 3);
  assert.deepEqual(summary.droppedWarnings, [{ id: 'home', viewport: 'desktop', side: 'a', resourceType: 'font', origin: 'https://use.example-site.net', count: 3 }]);
  assert.equal(summary.verdict, 'match');
  assert.equal(Object.hasOwn(summarizeReport(data, { target: 'about' }), 'droppedRequestCount'), false);
});

test('summary bounds the warning list and keeps the full count (R3.8)', () => {
  const data = report();
  data.entries = ['one', 'two', 'three'].map(id => ({ id, viewports: [row({ a: [{ resourceType: 'stylesheet', origin: 'https://use.example-site.net', count: 2 }], b: [] })] }));
  const summary = summarizeReport(data, { maxTargets: 1 });
  assert.equal(summary.droppedRequestCount, 6);
  assert.equal(summary.droppedWarnings.length, 1);
  assert.equal(summary.droppedWarningsOmitted, 2);
});

test('summary drops a malformed aborted-request record from a report (R3.8)', () => {
  const data = report();
  data.entries = [{ id: 'home', viewports: [row({
    a: [{ resourceType: 'font', origin: 'javascript:alert(1)', count: 1 }, { resourceType: 'font', origin: 'https://use.example-site.net', count: -1 }, { resourceType: 'Font<', origin: 'https://use.example-site.net', count: 1 }, null],
    b: 'x',
  })] }];
  assert.equal(Object.hasOwn(summarizeReport(data), 'droppedRequestCount'), false);
  data.entries[0].viewports[0].dropped = 'x';
  assert.equal(Object.hasOwn(summarizeReport(data), 'droppedRequestCount'), false);
});

test('droppedForRow and summary carry the cut of a list (R3.8)', () => {
  const font = { resourceType: 'font', origin: 'https://use.example-site.net', count: 2 };
  assert.deepEqual(droppedForRow({ dropped: [font], droppedOmitted: 4 }, { droppedOmitted: 1 }), { a: [font], b: [], omitted: { a: 4, b: 1 } });
  assert.deepEqual(droppedForRow({ droppedOmitted: 4 }, undefined), { a: [], b: [], omitted: { a: 4, b: 0 } });
  for (const bad of [0, -1, 1.5, '4', null, 1e9]) assert.equal(droppedForRow({ droppedOmitted: bad }, undefined), null);
  const data = report();
  data.entries = [{ id: 'home', viewports: [row({ a: [font], b: [], omitted: { a: 4, b: 'x' } })] }, { id: 'about', viewports: [row({ a: [], b: [], omitted: { a: 3, b: 1 } })] }];
  assert.equal(droppedNotListed(data), 8);
  const summary = summarizeReport(data);
  assert.equal(summary.droppedRequestCount, 2);
  assert.equal(summary.droppedNotListed, 8);
  assert.equal(summarizeReport(data, { target: 'about' }).droppedNotListed, 4);
  assert.equal(summarizeReport(data, { target: 'about' }).droppedRequestCount, 0);
});

test('summary counts requests, the same number as the viewer: one group of three requests reads 3 (R3.8)', () => {
  const data = report();
  data.entries = [{ id: 'home', viewports: [row({ a: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 3 }], b: [] })] }];
  const summary = summarizeReport(data);
  assert.equal(summary.droppedRequestCount, 3);
  assert.equal(summary.droppedWarnings.length, 1);
});

test('decideRequest records a drop and nothing else, and the request handler uses it (R3.8)', () => {
  const log = createDroppedLog();
  const base = { method: 'GET', topLevel: false, navigation: false, resourceType: 'font', origin: 'https://example.com', remote: true };
  assert.equal(decideRequest(log, { ...base, url: 'https://use.example-site.net/a.woff2?x=1' }), 'drop');
  assert.equal(decideRequest(log, { ...base, url: 'https://example.com/own.woff2' }), 'allow');
  assert.equal(decideRequest(log, { ...base, url: 'https://use.example-site.net/a', method: 'POST' }), 'block');
  assert.equal(decideRequest(log, { ...base, url: 'https://use.example-site.net/', topLevel: true, navigation: true }), 'block');
  assert.deepEqual(droppedFields(log), { dropped: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 1 }] });
  // The handler must decide through decideRequest. A bare requestPolicy call would skip the record.
  const source = readFileSync(new URL('../../src/capture/index.js', import.meta.url), 'utf8');
  assert.match(source, /decideRequest\(droppedLog,/);
  assert.doesNotMatch(source, /\brequestPolicy\(/);
  assert.match(source, /decideRequest\(droppedLog, \{[^\n]*resourceType: request\.resourceType\(\)/);
});

// compareRuns loads pngjs and pixelmatch. The plain unit job installs no dependency, so it skips this test.
// The job with dependencies runs it.
const hasImageTools = await Promise.all([import('pngjs'), import('pixelmatch')]).then(() => true, () => false);
test('compareRuns copies the dropped record of both runs into the report row (R3.8)', { skip: !hasImageTools && 'pngjs or pixelmatch is not installed' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tk-dropped-'));
  try {
    const font = { resourceType: 'font', origin: 'https://use.example-site.net', count: 2 };
    const run = (id, side, capture) => ({ schemaVersion: 2, id, side, label: id, state: 'partial', settingsHash: 'sha256:' + 'a'.repeat(64),
      settings: { artifacts: ['screenshot'], targets: [{ id: 'home', kind: 'page', title: 'home', path: '/' }], viewports: [{ id: 'desktop', width: 10, height: 10, deviceScaleFactor: 1 }],
        sides: { [side]: { origin: 'https://example.com', settle: {} } } },
      tools: [{ name: 'playwright', version: '1', settingsHash: 'sha256:' + 'a'.repeat(64) }],
      captures: [{ targetId: 'home', viewportId: 'desktop', state: 'failed', artifacts: {}, error: { code: 'X', message: 'x' }, ...capture }] });
    for (const item of [run('run-a', 'production', { dropped: [font], droppedOmitted: 4 }), run('run-b', 'local', {})]) {
      await mkdir(join(root, 'runs', item.id), { recursive: true });
      await writeFile(join(root, 'runs', item.id, 'run.json'), JSON.stringify(item));
    }
    const { report } = await compareRuns({ runsRoot: join(root, 'runs'), runA: 'run-a', runB: 'run-b', outputDir: join(root, 'out') });
    assert.deepEqual(report.entries[0].viewports[0].dropped, { a: [font], b: [], omitted: { a: 4, b: 0 } });
    const summary = summarizeReport(report);
    assert.equal(summary.droppedRequestCount, 2);
    assert.equal(summary.droppedNotListed, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});
