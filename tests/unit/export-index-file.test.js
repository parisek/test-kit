import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishIndex } from '../../src/export/index-file.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const H1 = 'sha256:' + 'a'.repeat(64);
const H2 = 'sha256:' + 'b'.repeat(64);
const run = (id, at, settingsHash = H1) => ({ id, value: { at, settingsHash } });
const report = (id, generated, aRunId, bRunId, extra = {}) => ({
  id,
  value: { meta: { generated }, pair: { kind: 'ab', aRunId, bRunId }, entries: [{}, {}], ...extra },
});
const build = (history, options = {}) => buildPublishIndex(history, { now: NOW, ...options });

test('top level has fixed keys and generatedAt from the clock', () => {
  const index = build({ runs: [], reports: [] });
  assert.deepEqual(Object.keys(index), ['schemaVersion', 'generatedAt', 'reports', 'runs']);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.generatedAt, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(build({ runs: [], reports: [] }, { now: NOW.getTime() }), index);
  assert.throws(() => buildPublishIndex({}, { now: 'nope' }), /clock/);
  assert.throws(() => buildPublishIndex({}), /clock/);
});

test('a readable run and report get all fields and relative paths', () => {
  const index = build({
    runs: [run('run-a', '2026-01-01T00:00:00.000Z'), run('run-b', '2026-01-02T00:00:00.000Z')],
    reports: [report('rep-1', '2026-01-03T00:00:00.000Z', 'run-a', 'run-b')],
  });
  assert.deepEqual(index.runs[1], { id: 'run-a', createdAt: '2026-01-01T00:00:00.000Z', settingsHash: H1, path: 'runs/run-a/run.json' });
  assert.deepEqual(index.reports, [{ id: 'rep-1', kind: 'ab', createdAt: '2026-01-03T00:00:00.000Z', settingsHash: H1, path: 'reports/rep-1/report.json', targets: 2 }]);
  assert.deepEqual(Object.keys(index.reports[0]), ['id', 'kind', 'createdAt', 'settingsHash', 'path', 'targets']);
  assert.deepEqual(Object.keys(index.runs[0]), ['id', 'createdAt', 'settingsHash', 'path']);
});

test('createdAt is null unless it is the exact toISOString form', () => {
  const bad = ['2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00', '2026-02-30T00:00:00.000Z', '2026-01-01T00:00:00.000z', 12345, null, {}];
  const index = build({ runs: bad.map((at, i) => run(`r${i}`, at)), reports: bad.map((g, i) => report(`p${i}`, g, 'r0', 'r0')) });
  for (const entry of [...index.runs, ...index.reports]) assert.equal(entry.createdAt, null, entry.id);
});

test('settingsHash needs the sha256: prefix', () => {
  const index = build({
    runs: [run('r1', '2026-01-01T00:00:00.000Z', 'md5:abc'), run('r2', '2026-01-01T00:00:00.000Z', 42), { id: 'r3', value: { at: '2026-01-01T00:00:00.000Z' } }, run('r4', '2026-01-01T00:00:00.000Z', H2)],
    reports: [report('p1', '2026-01-01T00:00:00.000Z', 'r1', 'r1'), report('p4', '2026-01-01T00:00:00.000Z', 'r4', 'r4')],
  });
  assert.deepEqual(index.runs.map(r => r.settingsHash).sort(), [H2, null, null, null].sort());
  assert.equal(index.reports.find(r => r.id === 'p1').settingsHash, null);
  assert.equal(index.reports.find(r => r.id === 'p4').settingsHash, H2);
});

test('report hash is null when A and B hashes differ or a run is missing or unreadable', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const index = build({
    runs: [run('a', at, H1), run('b', at, H2), { id: 'bad', error: 'Unreadable metadata' }],
    reports: [
      report('differ', at, 'a', 'b'),
      report('same', at, 'a', 'a'),
      report('no-b', at, 'a', 'ghost'),
      report('no-a', at, 'ghost', 'a'),
      report('unreadable-b', at, 'a', 'bad'),
      report('invalid-id', at, 'a', '../a'),
      report('no-ids', at, undefined, undefined),
    ],
  });
  const hash = id => index.reports.find(r => r.id === id).settingsHash;
  assert.equal(hash('same'), H1);
  for (const id of ['differ', 'no-b', 'no-a', 'unreadable-b', 'invalid-id', 'no-ids']) assert.equal(hash(id), null, id);
});

test('a subject report takes the hash of subject.runId and its kind', () => {
  const index = build({
    runs: [run('a', '2026-01-01T00:00:00.000Z', H2)],
    reports: [{ id: 's1', value: { meta: {}, subject: { kind: 'single', runId: 'a' }, entries: [] } }],
  });
  assert.deepEqual(index.reports[0], { id: 's1', kind: 'single', createdAt: null, settingsHash: H2, path: 'reports/s1/report.json', targets: 0 });
});

test('a legacy v1 report has null kind and hash but keeps its other fields', () => {
  const index = build({
    runs: [run('a', '2026-01-01T00:00:00.000Z')],
    reports: [{ id: 'v1', value: { meta: { generated: '2026-01-05T00:00:00.000Z' }, entries: [1, 2, 3] } }],
  });
  assert.deepEqual(index.reports[0], { id: 'v1', kind: null, createdAt: '2026-01-05T00:00:00.000Z', settingsHash: null, path: 'reports/v1/report.json', targets: 3 });
});

test('kind is null unless it is a string; targets is null unless entries is an array', () => {
  const index = build({
    runs: [],
    reports: [
      { id: 'k1', value: { pair: { kind: 7 }, entries: 'x' } },
      { id: 'k2', value: { pair: {}, entries: { length: 4 } } },
      { id: 'k3', value: { pair: { kind: 'ab' } } },
    ],
  });
  const by = id => index.reports.find(r => r.id === id);
  assert.equal(by('k1').kind, null);
  assert.equal(by('k1').targets, null);
  assert.equal(by('k2').targets, null);
  assert.equal(by('k3').kind, 'ab');
  assert.equal(by('k3').targets, null);
});

test('an unreadable entry has null fields and a null path', () => {
  const index = build({
    runs: [{ id: 'r-bad', error: 'Unreadable metadata' }],
    reports: [{ id: 'p-bad', error: 'Unreadable metadata' }, { id: 'p-array', value: [] }],
  });
  assert.deepEqual(index.runs, [{ id: 'r-bad', createdAt: null, settingsHash: null, path: null }]);
  assert.deepEqual(index.reports.find(r => r.id === 'p-bad'), { id: 'p-bad', kind: null, createdAt: null, settingsHash: null, path: null, targets: null });
  assert.equal(index.reports.find(r => r.id === 'p-array').path, null);
});

test('a readable report with unavailable evidence has only path null', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const history = { runs: [run('a', at)], reports: [report('lost', at, 'a', 'a'), report('kept', at, 'a', 'a')] };
  const index = build(history, { unavailableReportIds: new Set(['lost', 'ghost']) });
  const lost = index.reports.find(r => r.id === 'lost');
  const kept = index.reports.find(r => r.id === 'kept');
  assert.equal(lost.path, null);
  assert.deepEqual({ ...lost, path: kept.path, id: kept.id }, kept);
  assert.equal(build(history, { unavailableReportIds: ['lost'] }).reports.find(r => r.id === 'lost').path, null);
  assert.equal(index.runs[0].path, 'runs/a/run.json');
});

test('sort is newest first, null last, ties by id descending with plain comparison', () => {
  const t1 = '2026-01-01T00:00:00.000Z';
  const t2 = '2026-01-02T00:00:00.000Z';
  const index = build({
    runs: [run('b', t1), run('B', t1), run('a', t1), run('c', t2), { id: 'z-bad', error: 'x' }, { id: 'y-bad', error: 'x' }, run('nodate', 'junk')],
    reports: [],
  });
  // Code-unit order puts 'b' > 'a' > 'B'. localeCompare would order 'B' and 'b' differently.
  assert.deepEqual(index.runs.map(r => r.id), ['c', 'b', 'a', 'B', 'z-bad', 'y-bad', 'nodate']);
});

test('ids that scanHistory would not return are dropped, so no path holds ..', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const index = build({ runs: [run('..', at), run('a/b', at), run('ok', at), run('', at)], reports: [report('../x', at, 'ok', 'ok')] });
  assert.deepEqual(index.runs.map(r => r.id), ['ok']);
  assert.deepEqual(index.reports, []);
  assert.ok(!JSON.stringify(index).includes('..'));
});

test('output is deterministic and input is not changed', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const history = { runs: [run('a', at), run('b', '2026-01-02T00:00:00.000Z')], reports: [report('p', at, 'a', 'a'), report('q', '2026-01-03T00:00:00.000Z', 'a', 'b')] };
  const before = JSON.stringify(history);
  const first = JSON.stringify(build(history));
  assert.equal(JSON.stringify(build(history)), first);
  assert.equal(JSON.stringify(history), before);
  const reversed = { runs: [...history.runs].reverse(), reports: [...history.reports].reverse() };
  assert.equal(JSON.stringify(build(reversed)), first);
});

test('missing lists give empty lists', () => {
  assert.deepEqual(build({}).reports, []);
  assert.deepEqual(build(undefined).runs, []);
});
