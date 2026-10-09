import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContentSnapshot } from '../../src/content/snapshot.js';
import { builtinChecks, runContentChecks } from '../../src/checks/index.js';
const doc = (changes = {}) => ({ schemaVersion: 1, extractorVersion: '1.0.0', source: 'settled-dom', title: 'Example site', lang: 'en', text: 'Hello', headings: [{ level: 1, text: 'Hello' }], images: [], links: [], omitted: { headings: 0, images: 0, links: 0, text: false }, ...changes });
test('content snapshot rejects incompatible extractors, unbounded data and unsafe link paths', () => {
  for (const value of [doc({ extractorVersion: '2.0.0' }), doc({ text: 'x'.repeat(100001) }), doc({ headings: Array(1001).fill({ level: 1, text: '' }) }), doc({ links: [{ path: '//example.invalid', text: '' }] }), doc({ links: [{ path: '/a\n', text: '' }] }), doc({ omitted: { headings: -1, images: 0, links: 0, text: false } })]) assert.throws(() => validateContentSnapshot(value));
  const source = doc({ title: '<script>alert(1)</script>' });
  const result = validateContentSnapshot(source); source.headings[0].text = 'mutated';
  assert.equal(result.title, '<script>alert(1)</script>'); assert.equal(result.headings[0].text, 'Hello');
});
test('checks are opt-in pure plugins with no default findings', () => {
  assert.deepEqual(runContentChecks(doc(), []), []);
  for (const plugin of Object.values(builtinChecks)) { assert.equal(typeof plugin.id, 'string'); assert.equal(typeof plugin.title, 'string'); assert.deepEqual(plugin.applies, { artifacts: ['content'] }); assert.equal(typeof plugin.check, 'function'); }
  assert.throws(() => runContentChecks(doc(), ['constructor']));
  assert.throws(() => runContentChecks(doc(), ['lang', 'lang']));
});
test('heading outline checks one h1 and skipped levels while marking omissions', () => {
  assert.deepEqual(builtinChecks['heading-outline'].check(doc()), []);
  const findings = builtinChecks['heading-outline'].check(doc({ headings: [{ level: 2, text: 'First' }, { level: 4, text: 'Skip' }] }), { targetId: 'example-site', viewportId: 'mobile' });
  assert.equal(findings.length, 3); assert.equal(findings[0].targetId, 'example-site'); assert.equal(findings[0].viewportId, 'mobile');
  const incomplete = builtinChecks['heading-outline'].check(doc({ headings: [], omitted: { headings: 2, images: 0, links: 0, text: false } }));
  assert.equal(incomplete.length, 1); assert.equal(incomplete[0].evidence.state, 'incomplete');
});
test('language is declared metadata, never guessed or silently passed without expectation', () => {
  assert.deepEqual(builtinChecks.lang.check(doc(), { expectedLanguage: 'EN' }), []);
  assert.equal(builtinChecks.lang.check(doc())[0].evidence.state, 'unknown');
  assert.equal(builtinChecks.lang.check(doc({ lang: '' }), { expectedLanguage: 'en' }).length, 1);
  assert.equal(builtinChecks.lang.check(doc({ lang: 'en-US' }), { expectedLanguage: 'en' }).length, 1);
});
test('missing alt differs from deliberate decorative empty alt', () => {
  const findings = builtinChecks['empty-alt'].check(doc({ images: [{ src: '/a.png', alt: null, role: '' }, { src: '/b.png', alt: '', role: '' }, { src: '/c.png', alt: ' ', role: '' }, { src: '/d.png', alt: '', role: 'img' }] }));
  assert.equal(findings.length, 3); assert.deepEqual(findings.map(item => item.evidence.src), ['/a.png', '/c.png', '/d.png']);
  assert.equal(builtinChecks['empty-title'].check(doc({ title: '  ' })).length, 1);
});
test('internal links only use own stored final responses and never turn unknown into success', () => {
  const value = doc({ links: ['/ok', '/broken', '/unseen', '/redirect', '/ok'].map(path => ({ path, text: path })) });
  const findings = builtinChecks['internal-links'].check(value, { responses: { '/ok': 200, '/broken': 404, '/redirect': 302 } });
  assert.equal(findings.length, 3); assert.equal(findings[0].evidence.statusCode, 404); assert.equal(findings[1].evidence.state, 'unknown'); assert.equal(findings[2].evidence.state, 'unknown');
});
test('text difference refuses incomplete evidence and bounds displayed text', () => {
  assert.deepEqual(builtinChecks['text-difference'].check(doc(), { before: doc() }), []);
  const result = builtinChecks['text-difference'].check(doc({ text: 'b'.repeat(3000) }), { before: doc() });
  assert.equal(result[0].evidence.after.length, 2000); assert.equal(result[0].evidence.omitted, true);
  assert.equal(builtinChecks['text-difference'].check(doc())[0].evidence.state, 'unknown');
  assert.equal(builtinChecks['text-difference'].check(doc({ omitted: { headings: 0, images: 0, links: 0, text: true } }), { before: doc() })[0].evidence.state, 'incomplete');
});
test('a new selected check reuses the same stored snapshot without capture or mutation', () => {
  const stored = doc({ title: '', images: [{ src: '/example.png', alt: null, role: '' }] });
  const original = JSON.stringify(stored);
  assert.deepEqual(runContentChecks(stored, ['heading-outline']), []);
  const later = runContentChecks(stored, ['heading-outline', 'empty-title', 'empty-alt'], { targetId: 'example-site' });
  assert.deepEqual(later.map(item => item.checkId), ['empty-title', 'empty-alt']);
  assert.equal(JSON.stringify(stored), original);
});
import { compareContentSnapshots, validateContentComparison } from '../../src/content/compare.js';
test('content comparison keeps resolved A defects without counting them on B', () => {
  const result = compareContentSnapshots(doc({ title: '' }), doc(), { checks: ['empty-title', 'text-difference'], targetId: 'example-site' });
  assert.equal(result.changed, false); assert.equal(result.checks[0].a.state, 'failed'); assert.equal(result.checks[0].b.state, 'passed'); assert.deepEqual(result.findings, []);
  const unknown = compareContentSnapshots(doc(), doc(), { checks: ['lang'] });
  assert.equal(unknown.incomplete, true); assert.equal(unknown.changed, false); assert.equal(unknown.checks[0].b.state, 'incomplete');
});
test('content comparison bounds findings and rejects forged successful states', () => {
  const images = Array.from({ length: 1000 }, (_, index) => ({ src: `/image-${index}.png`, alt: null, role: '' }));
  const result = compareContentSnapshots(doc(), doc({ images }), { checks: ['empty-alt'] });
  assert.equal(result.checks[0].b.findings.length, 50); assert.equal(result.checks[0].b.omitted, 950); assert.equal(result.incomplete, true);
  const forged = structuredClone(result); forged.checks[0].b.state = 'passed'; assert.throws(() => validateContentComparison(forged));
});
import { targetClass, targetState } from '../../src/report/classify.js';
test('incomplete content never passes while measured B defects remain unexplained', () => {
  const target = { id: 'example-site', viewports: [{ id: 'wide', state: 'missing', artifacts: { content: { state: 'missing', diff: { checks: 2 } } } }] };
  const report = { entries: [target], findings: [], causes: [] };
  assert.equal(targetState(target), 'missing'); assert.equal(targetClass(report, target), null);
  report.findings.push({ targetId: target.id, viewportId: 'wide', artifact: 'content', message: 'A measured defect' });
  assert.equal(targetClass(report, target), 'unexplained');
  const empty = { id: 'empty', viewports: [{ id: 'wide', state: 'complete', artifacts: { content: { state: 'complete', diff: { checks: 0 } } } }] };
  assert.equal(targetClass({ entries: [empty], findings: [], causes: [] }, empty), null);
});
import { storedResponses } from '../../src/content/responses.js';
test('stored link evidence retains requested query paths and conflicting measurements stay unknown', () => {
  const run = { side: 'local', settings: { targets: [{ id: 'query', paths: { local: '/item?mode=one' } }, { id: 'redirect', path: '/old' }, { id: 'duplicate', path: '/old' }] }, captures: [
    { targetId: 'query', viewportId: 'wide', state: 'captured', statusCode: 200 },
    { targetId: 'redirect', viewportId: 'wide', state: 'captured', statusCode: 200 },
    { targetId: 'duplicate', viewportId: 'wide', state: 'captured', statusCode: 404 },
    { targetId: 'query', viewportId: 'phone', state: 'captured', statusCode: 503 }
  ] };
  const responses = storedResponses(run, 'wide');
  assert.equal(responses['/item?mode=one'], 200); assert.equal(Object.hasOwn(responses, '/item'), false); assert.equal(responses['/old'], null);
  const findings = builtinChecks['internal-links'].check(doc({ links: [{ path: '/item', text: '' }, { path: '/item?mode=one', text: '' }, { path: '/old', text: '' }] }), { responses });
  assert.equal(findings.length, 2); assert.ok(findings.every(item => item.evidence.state === 'unknown'));
});
