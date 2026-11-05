import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinChecks, CHECK_VERSION } from '../../src/checks/index.js';
import { compareContentSnapshots, validateContentComparison } from '../../src/content/compare.js';
import { safeLines, safeCount, validLineEvidence } from '../../src/checks/builtin/text-difference.js';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';

const doc = (text) => ({ schemaVersion: 1, extractorVersion: '1.0.0', source: 'settled-dom', title: 'Example', lang: 'en', text, headings: [{ level: 1, text: 'Hello' }], images: [], links: [], omitted: { headings: 0, images: 0, links: 0, text: false } });
const check = builtinChecks['text-difference'].check;
const nav = 'Home\nProducts\nContact';
const footer = 'Terms\nPrivacy';

test('a paragraph on side A only gives one finding with onlyInA', () => {
  const closing = 'Thank you for reading this page.';
  const out = check(doc(`${nav}\nBody text\n${footer}`), { before: doc(`${nav}\nBody text\n${closing}\n${footer}`), sideA: 'production', sideB: 'staging' });
  assert.equal(out.length, 1);
  const e = out[0].evidence;
  assert.deepEqual(e.onlyInA, [closing]); assert.equal(e.onlyInACount, 1);
  assert.deepEqual(e.onlyInB, []); assert.equal(e.onlyInBCount, 0);
  assert.equal(e.sideA, 'production'); assert.equal(e.sideB, 'staging');
});

test('lines on both sides are not listed and whitespace-only changes give no gap', () => {
  assert.deepEqual(check(doc('Home\n  Products   list \n\n\nContact'), { before: doc('Home\nProducts list\nContact\n') }), []);
  const out = check(doc(`${nav}\nNew line`), { before: doc(nav) });
  assert.deepEqual(out[0].evidence.onlyInB, ['New line']);
  assert.ok(!out[0].evidence.onlyInA.includes('Home'));
});

test('multisets: a repeated line counts by its extra copies', () => {
  const out = check(doc('Buy\nBuy'), { before: doc('Buy\nBuy\nBuy') });
  assert.deepEqual(out[0].evidence.onlyInA, ['Buy']); assert.equal(out[0].evidence.onlyInACount, 1);
});

test('short lines stay: a price and a call to action', () => {
  const out = check(doc('Page'), { before: doc('Page\n99 Kc\nBuy') });
  assert.deepEqual(out[0].evidence.onlyInA, ['99 Kc', 'Buy']);
});

test('500 differing lines give 20 listed lines and the exact count, each cut at 200 characters', () => {
  const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const out = check(doc('other'), { before: doc(many) });
  assert.equal(out[0].evidence.onlyInA.length, 20); assert.equal(out[0].evidence.onlyInACount, 500);
  const long = check(doc('x'), { before: doc('y'.repeat(900)) });
  assert.equal(long[0].evidence.onlyInA[0].length, 200);
});

test('the same lines in another order give a finding with no listed line', () => {
  const out = check(doc('B\nA'), { before: doc('A\nB') });
  assert.equal(out[0].evidence.orderChanged, true); assert.equal(out[0].evidence.onlyInACount, 0);
});

test('a comparison carries the side names and validates', () => {
  const r = compareContentSnapshots(doc('a'), doc('b'), { checks: ['text-difference'], targetId: 't', sideA: 'production', sideB: 'local' });
  assert.equal(r.checkVersion, CHECK_VERSION);
  assert.equal(r.findings[0].evidence.sideA, 'production');
  assert.deepEqual(validateContentComparison(JSON.parse(JSON.stringify(r))), r);
});

test('a sidecar written by check version 1.0.0 still loads', () => {
  const r = compareContentSnapshots(doc('a'), doc('b'), { checks: ['text-difference'], targetId: 't' });
  const old = JSON.parse(JSON.stringify(r));
  old.checkVersion = '1.0.0';
  const evidence = { before: 'a', after: 'b', beforeLength: 1, afterLength: 1, omitted: false };
  old.findings[0].evidence = evidence; old.checks[0].b.findings[0].evidence = evidence;
  assert.equal(validateContentComparison(old).checkVersion, '1.0.0');
  old.checkVersion = '9.9.9';
  assert.throws(() => validateContentComparison(old), /Invalid content comparison/);
});

// summary and query
const prov = { tool: 'example', version: '1', settingsHash: 'sha256:x' };
async function reportWith(detail, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'td-'));
  const gapped = (id) => ({ id, kind: 'page', title: id, viewports: [{ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, artifacts: { content: { state: 'complete', scope: { checks: ['text-difference'] }, a: { ...prov, src: 'a/c.json' }, b: { ...prov, src: 'b/c.json' }, diff: { ...prov, src: 'diff/c.json', changed: true, ...(id === 'gap' ? { lineGaps: extra.lineGaps ?? 3 } : {}) } } } }], artifacts: {} });
  const report = { schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
    checks: { 'text-difference': { basis: 'relative', layer: 'package', title: 'Stored text difference' } }, overrides: [], causes: [], findings: [], rules: {}, entries: [gapped('gap'), gapped('none')] };
  await mkdir(join(dir, 'diff'));
  await writeFile(join(dir, 'diff/c.json'), JSON.stringify(detail));
  await writeFile(join(dir, 'report.json'), JSON.stringify(report));
  return { dir, report, path: join(dir, 'report.json') };
}

test('query prints the one-sided lines first, with side names, and not twice', async () => {
  const r = compareContentSnapshots(doc(`${nav}\nOnly A`), doc(`${nav}\nOnly B`), { checks: ['text-difference'], targetId: 'gap', viewportId: 'desktop', sideA: 'production', sideB: 'local' });
  const { dir, path } = await reportWith(r);
  try {
    const out = await queryArtifact(path, { target: 'gap', viewport: 'desktop', artifact: 'content' });
    assert.equal(Object.keys(out.diff)[0], 'oneSided');
    assert.deepEqual(out.diff.oneSided.sides, { a: 'production', b: 'local' });
    assert.deepEqual(out.diff.oneSided.lines, [{ side: 'a', name: 'production', text: 'Only A' }, { side: 'b', name: 'local', text: 'Only B' }]);
    assert.equal(out.diff.oneSided.omittedLines, 0);
    assert.equal(out.diff.findings[0].evidence.onlyInA, undefined);
    assert.equal(out.diff.findings[0].evidence.onlyInACount, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('query bounds the one-sided list by maxLines and counts the rest', async () => {
  const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const r = compareContentSnapshots(doc(many), doc('x'), { checks: ['text-difference'], targetId: 'gap', viewportId: 'desktop' });
  const { dir, path } = await reportWith(r);
  try {
    const out = await queryArtifact(path, { target: 'gap', viewport: 'desktop', artifact: 'content', maxLines: 5 });
    assert.equal(out.diff.oneSided.lines.length, 5);
    assert.equal(out.diff.oneSided.lines.length + out.diff.oneSided.omittedLines, 501);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('query reads an old sidecar without one-sided lines', async () => {
  const r = compareContentSnapshots(doc('a'), doc('b'), { checks: ['text-difference'], targetId: 'gap', viewportId: 'desktop' });
  r.checkVersion = '1.0.0';
  const evidence = { before: 'a', after: 'b', beforeLength: 1, afterLength: 1, omitted: false };
  r.findings[0].evidence = evidence; r.checks[0].b.findings[0].evidence = evidence;
  const { dir, path } = await reportWith(r);
  try {
    const out = await queryArtifact(path, { target: 'gap', viewport: 'desktop', artifact: 'content' });
    assert.equal(out.diff.oneSided, undefined);
    assert.equal(out.diff.checkVersion, '1.0.0');
    assert.equal(out.diff.findings[0].evidence.before, 'a');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('summary counts the targets with a gap as one integer', async () => {
  const { dir, report } = await reportWith({});
  try {
    assert.equal(summarizeReport(report).lineGapTargets, 1);
    assert.equal(summarizeReport(report, { target: 'none' }).lineGapTargets, undefined);
    report.entries[0].viewports[0].artifacts.content.diff.lineGaps = 0;
    assert.equal('lineGapTargets' in summarizeReport(report), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a different count of blank lines gives no finding', () => {
  assert.deepEqual(check(doc('A\n\n\n\nB'), { before: doc('A\nB') }), []);
  assert.deepEqual(check(doc('A\n \t \nB\n\n'), { before: doc('\n\nA\nB') }), []);
});

test('a stored finding with malformed line evidence is refused, and the readers never throw', () => {
  const base = compareContentSnapshots(doc('a'), doc('b'), { checks: ['text-difference'], targetId: 't' });
  const bad = (change) => {
    const r = JSON.parse(JSON.stringify(base));
    Object.assign(r.findings[0].evidence, change); Object.assign(r.checks[0].b.findings[0].evidence, change);
    return r;
  };
  for (const change of [{ onlyInB: 'not a list' }, { onlyInA: [1, null] }, { onlyInA: Array.from({ length: 21 }, () => 'x'), onlyInACount: 21 }, { onlyInB: ['y'.repeat(201)] }, { onlyInBCount: -1 }, { onlyInBCount: 0 }, { sideA: 5 }, { onlyInA: {} }]) {
    assert.throws(() => validateContentComparison(bad(change)), /Invalid content comparison/, JSON.stringify(change).slice(0, 60));
  }
  assert.equal(validLineEvidence(base.findings[0].evidence), true);
  assert.deepEqual(safeLines('x'), []);
  assert.deepEqual(safeLines([1, 'a', null, 'b'.repeat(900)]).map(l => l.length), [1, 200]);
  assert.equal(safeLines(Array.from({ length: 500 }, () => 'z')).length, 20);
  assert.equal(safeCount('9'), 0); assert.equal(safeCount(1e12, 3), 3);
});

test('query refuses a sidecar with malformed line evidence', async () => {
  const r = compareContentSnapshots(doc('a'), doc('b'), { checks: ['text-difference'], targetId: 'gap', viewportId: 'desktop' });
  r.findings[0].evidence.onlyInB = { huge: 'x'.repeat(5000) }; r.checks[0].b.findings[0].evidence.onlyInB = r.findings[0].evidence.onlyInB;
  const { dir, path } = await reportWith(r);
  try { await assert.rejects(queryArtifact(path, { target: 'gap', viewport: 'desktop', artifact: 'content' }), /Invalid content comparison/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
