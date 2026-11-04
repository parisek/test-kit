import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptReport, adaptV2, validateReport } from '../../src/report/model.js';
import { artifactClass, cellClass, findingsFor, summarize, targetClass, targetState } from '../../src/report/classify.js';
import { BUILTIN_CONTENT_CHECKS, LEGACY_BEHAVIOR_ID, behaviorCheckId } from '../../src/report/catalog.js';
import { builtinChecks } from '../../src/checks/index.js';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { recordKnown } from '../../src/rules/record.js';
import { run, parseCommand } from '../../src/cli/run.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Reports of schemaVersion 3 (R9.7 to R9.11). All data uses example-site.
const provenance = { tool: 'example', version: '1', settingsHash: 'sha256:x' };
const entryOf = (src) => ({ ...provenance, src });
const catalog = () => ({
	'heading-outline': { basis: 'absolute', layer: 'package', title: 'Heading outline' },
	'text-difference': { basis: 'relative', layer: 'package', title: 'Stored text difference' },
	'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' },
	'eslint-no-console': { basis: 'absolute', layer: 'project', title: 'No console call' },
	'behavior.header-nav': { basis: 'relative', layer: 'project', title: 'header-nav' },
});
const pairContent = (checks = ['heading-outline', 'text-difference']) => ({ state: 'complete', scope: { checks },
	a: entryOf('a/content.json'), b: entryOf('b/content.json'), diff: { ...entryOf('diff/content.json'), changed: true, checks: checks.length } });
const absolute = (checks = ['a11y-axe']) => ({ state: 'complete', scope: { checks }, evidence: entryOf('runs/run-1/a11y/axe.json'), result: { violations: true, checks: checks.length } });
const pairReport = () => ({
	schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] },
	runs: [{ id: 'run-a' }, { id: 'run-b' }], pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' },
	checks: catalog(),
	entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'desktop', state: 'complete', artifacts: { content: pairContent() } }], artifacts: {} }],
	causes: [], findings: [], rules: {},
});
const subjectReport = () => ({
	schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] },
	runs: [{ id: 'run-1' }], subject: { kind: 'single-run', runId: 'run-1' },
	checks: Object.fromEntries(Object.entries(catalog()).filter(([, check]) => check.basis === 'absolute')),
	entries: [
		{ id: 'button', kind: 'component', title: 'Button', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: absolute() } }], artifacts: {} },
		{ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: { lint: absolute(['eslint-no-console']) } },
	],
	causes: [], findings: [], rules: {},
});
const lintFinding = (extra = {}) => ({ id: 'f-lint', targetId: '@project', artifact: 'lint', checkId: 'eslint-no-console', runId: 'run-1', layer: 'project',
	severity: 'error', message: 'Unexpected console statement.', location: { file: 'src/example-site/header.js', line: 12, column: 3 }, ...extra });
const axeFinding = (extra = {}) => ({ id: 'f-axe', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-axe', runId: 'run-1', layer: 'component',
	severity: 'error', message: 'color-contrast', location: { selector: '.example-site-button' }, ...extra });
const headingFinding = (extra = {}) => ({ id: 'f-h', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'heading-outline', runId: 'run-b', layer: 'package', message: 'One h1.', ...extra });

const says = (report, message) => assert.ok(validateReport(report).includes(message), `${message} not in ${JSON.stringify(validateReport(report))}`);

test('a pair report and a subject report pass the validator', () => {
	const pair = pairReport();
	pair.findings.push(headingFinding(), { id: 'f-t', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'text-difference', layer: 'package', message: 'Text differs.' }, lintFinding({ runId: 'run-b', targetId: 'home' }));
	pair.entries[0].kind = 'component';
	assert.deepEqual(validateReport(pair), []);
	const subject = subjectReport();
	subject.findings.push(axeFinding(), lintFinding());
	assert.deepEqual(validateReport(subject), []);
});

test('R9.1: a reader needs schemaVersion 3, and adaptReport reads versions 1, 2 and 3', () => {
	const old = { ...pairReport(), schemaVersion: 2 };
	assert.ok(validateReport(old).includes('Unsupported report schema version.'));
	assert.throws(() => adaptReport({ ...pairReport(), schemaVersion: 4 }), /schema version/);
	assert.equal(adaptReport(pairReport()).schemaVersion, 3);
	assert.equal(adaptReport(old).schemaVersion, 3);
	assert.equal(adaptReport({ meta: { viewports: [{ id: 'mobile' }] }, entries: [{ id: 'home', viewports: [{ id: 'mobile', ratio: 1 }] }] }).schemaVersion, 3);
});

test('R9.7: a report has exactly one of pair and subject', () => {
	const both = pairReport(); both.subject = { kind: 'single-run', runId: 'run-a' };
	says(both, 'A report has exactly one of pair and subject.');
	const none = pairReport(); delete none.pair;
	says(none, 'A report has exactly one of pair and subject.');
	const kind = subjectReport(); kind.subject.kind = 'update';
	says(kind, 'Unknown subject kind.');
	const run = subjectReport(); run.subject.runId = 'missing';
	says(run, 'Subject refers to an unknown run.');
});

test('R9.7: subject.key follows the comparison policy hash', () => {
	const policy = `sha256:${'a'.repeat(64)}`;
	const withHash = subjectReport(); withHash.meta.comparisonPolicyHash = policy;
	says(withHash, 'Invalid comparison policy identity.');
	withHash.subject.key = policy;
	assert.deepEqual(validateReport(withHash), []);
	const lone = subjectReport(); lone.subject.key = policy;
	says(lone, 'A subject key needs a comparison policy hash.');
});

test('R9.7: a subject report holds rules: {} and no known_diffs', () => {
	const rules = subjectReport(); rules.rules = { x: { text: 'x', evidence: 'x' } };
	says(rules, 'A subject report holds rules: {}.');
	const missing = subjectReport(); delete missing.rules;
	says(missing, 'A subject report holds rules: {}.');
	const known = subjectReport(); known.known_diffs = {};
	says(known, 'A subject report holds no known_diffs.');
});

test('R9.7: a subject report holds no relative check, finding or comparison artifact', () => {
	const check = subjectReport(); check.checks['text-difference'] = catalog()['text-difference'];
	says(check, 'A subject report holds no relative check.');
	const finding = subjectReport(); finding.findings.push({ id: 'f', targetId: 'button', viewportId: 'desktop', artifact: 'html', message: 'x' });
	says(finding, 'A subject report holds no relative finding.');
	const comparison = subjectReport(); comparison.entries[0].viewports[0].artifacts.html = pairContent();
	says(comparison, 'A subject report holds no comparison artifact.');
});

test('R9.8: the checks catalog is complete and a checkId must be in it', () => {
	const missing = pairReport(); delete missing.checks;
	says(missing, 'checks must be an object.');
	const basis = pairReport(); basis.checks['heading-outline'].basis = 'maybe';
	says(basis, 'Check needs a basis of absolute or relative.');
	const layer = pairReport(); layer.checks['heading-outline'].layer = 'site';
	says(layer, 'Check needs a layer.');
	const title = pairReport(); title.checks['heading-outline'].title = '';
	says(title, 'Check needs a title.');
	const id = pairReport(); id.checks['bad id'] = catalog()['heading-outline'];
	says(id, 'Invalid check id.');
	const unknown = pairReport(); unknown.findings.push(headingFinding({ checkId: 'unknown-check' }));
	says(unknown, 'A finding names a check that is not in the catalog.');
});

test('R8.11: checkId is absent on screenshot and html findings and present on the others', () => {
	const shot = pairReport(); shot.findings.push({ id: 'f', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot', checkId: 'heading-outline' });
	says(shot, 'A screenshot or html finding has no checkId.');
	const content = pairReport(); content.findings.push(headingFinding({ checkId: undefined }));
	says(content, 'A finding of this artifact needs a checkId.');
	const kind = pairReport(); kind.findings.push(headingFinding({ artifact: 'speed' }));
	says(kind, 'Finding names an unknown artifact.');
});

test('R9.8: layer is one of four values', () => {
	const report = pairReport(); report.findings.push(headingFinding({ layer: 'site' }));
	says(report, 'Unknown finding layer.');
});

test('R9.8: an absolute finding carries the run of its report, a relative finding carries none', () => {
	const none = pairReport(); none.findings.push(headingFinding({ runId: undefined }));
	says(none, 'An absolute finding needs a runId that names a run of the report.');
	const other = pairReport(); other.findings.push(headingFinding({ runId: 'run-x' }));
	says(other, 'An absolute finding needs a runId that names a run of the report.');
	const sideA = pairReport(); sideA.findings.push(headingFinding({ runId: 'run-a' }));
	assert.deepEqual(validateReport(sideA), []);
	const subject = subjectReport(); subject.findings.push(axeFinding({ runId: 'run-b' }));
	says(subject, 'An absolute finding needs a runId that names a run of the report.');
	const relative = pairReport(); relative.findings.push(headingFinding({ checkId: 'text-difference', runId: 'run-b' }));
	says(relative, 'A relative finding has no runId.');
	const shot = pairReport(); shot.findings.push({ id: 'f', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot', runId: 'run-b' });
	says(shot, 'A relative finding has no runId.');
});

test('R8.13: an override names a check of the catalog and carries a reason, an owner and a layer', () => {
	const report = pairReport();
	report.overrides = [{ checkId: 'a11y-axe', scope: { targets: ['home'] }, reason: 'Third-party widget.', owner: 'team-web', layer: 'project' }];
	assert.deepEqual(validateReport(report), []);
	report.overrides[0].checkId = 'unknown-check';
	says(report, 'An override names a check that is not in the catalog.');
	report.overrides[0] = { checkId: 'a11y-axe', reason: '', owner: 'team-web', layer: 'project' };
	says(report, 'Invalid override.');
	report.overrides = {};
	says(report, 'overrides must be an array.');
});

test('R9.9: an absolute artifact has evidence and a result, and no side A, side B or difference', () => {
	const noEvidence = subjectReport(); delete noEvidence.entries[0].viewports[0].artifacts.a11y.evidence;
	says(noEvidence, 'A complete absolute artifact needs indexed evidence.');
	const noResult = subjectReport(); noResult.entries[0].viewports[0].artifacts.a11y.result = { violations: 'yes', checks: 1 };
	says(noResult, 'A complete absolute artifact needs a result.');
	const sides = subjectReport(); sides.entries[0].viewports[0].artifacts.a11y.a = entryOf('a.json');
	says(sides, 'An absolute artifact has no a, b or diff.');
	const zero = subjectReport(); zero.entries[0].viewports[0].artifacts.a11y.result.checks = 0;
	says(zero, 'A complete artifact needs at least one executed check.');
	const path = subjectReport(); path.entries[0].viewports[0].artifacts.a11y.evidence.src = '../escape.json';
	says(path, 'Unsafe artifact path.');
	const state = subjectReport(); state.entries[0].viewports[0].artifacts.a11y.state = 'unknown';
	says(state, 'Unknown artifact measurement state.');
	const kinds = pairReport(); kinds.entries[0].artifacts.lint = absolute(['eslint-no-console']);
	assert.deepEqual(validateReport(kinds), []);
	const missing = subjectReport(); missing.entries[1].artifacts.lint = { state: 'missing', diagnostic: 'No check ran.' };
	assert.deepEqual(validateReport(missing), []);
});

test('R9.9: an absolute artifact sits at target or viewport scope, and an unknown kind fails', () => {
	const viewport = pairReport(); viewport.entries[0].viewports[0].artifacts.a11y = absolute();
	assert.deepEqual(validateReport(viewport), []);
	const unknown = pairReport(); unknown.entries[0].viewports[0].artifacts.speed = absolute();
	says(unknown, 'Unknown artifact kind.');
	const target = pairReport(); target.entries[0].artifacts.speed = absolute();
	says(target, 'Unknown artifact kind.');
	const shot = pairReport(); shot.entries[0].artifacts.screenshot = { state: 'complete' };
	says(shot, 'Unknown artifact kind.');
	const relative = pairReport(); relative.entries[0].artifacts.content = { ...pairContent(), diff: undefined };
	says(relative, 'Complete artifact needs indexed provenance.');
});

test('owner decision 2: scope.checks lists catalog ids, unique, derived by the producer', () => {
	const bad = pairReport(); bad.entries[0].viewports[0].artifacts.content.scope = { checks: ['unknown-check'] };
	says(bad, 'scope.checks names a check that is not in the catalog.');
	const twice = pairReport(); twice.entries[0].viewports[0].artifacts.content.scope = { checks: ['heading-outline', 'heading-outline'] };
	says(twice, 'Invalid artifact scope.');
	const shape = pairReport(); shape.entries[0].viewports[0].artifacts.content.scope = ['heading-outline'];
	says(shape, 'Invalid artifact scope.');
	const absent = pairReport(); delete absent.entries[0].viewports[0].artifacts.content.scope;
	assert.deepEqual(validateReport(absent), []);
});

test('R9.11: a lint finding has a location, no viewport, and a component or project target', () => {
	const viewport = subjectReport(); viewport.findings.push(lintFinding({ viewportId: 'desktop' }));
	says(viewport, 'A lint finding has no viewportId.');
	const location = subjectReport(); location.findings.push(lintFinding({ location: undefined }));
	says(location, 'A lint finding needs a location.');
	const target = subjectReport(); target.entries.push({ id: 'home', kind: 'page', viewports: [], artifacts: {} }); target.findings.push(lintFinding({ targetId: 'home' }));
	says(target, 'A lint finding names a component or the project entry.');
	const component = subjectReport(); component.findings.push(lintFinding({ targetId: 'button' }));
	assert.deepEqual(validateReport(component), []);
});

test('R9.11: the location is bounded, and @project is the project entry', () => {
	for (const location of [{ file: 'a.js', line: 0 }, { file: 'a.js', column: 3 }, { file: 'x'.repeat(501) }, { selector: '' }, { selector: 'a', file: 'a.js' }, { file: 'a.js', extra: 1 }, 'a.js', {}]) {
		const report = subjectReport(); report.findings.push(lintFinding({ location }));
		says(report, 'Invalid finding location.');
	}
	const kind = subjectReport(); kind.entries[1].kind = 'component';
	says(kind, 'The project entry has the id @project and the kind project.');
	const id = subjectReport(); id.entries.push({ id: 'other', kind: 'project', viewports: [], artifacts: {} });
	says(id, 'The project entry has the id @project and the kind project.');
	const entry = pairReport(); entry.entries[0].kind = 'folder';
	says(entry, 'Unknown entry kind.');
});

test('a lint or a11y finding comes from an absolute check', () => {
	const report = subjectReport(); report.findings.push(lintFinding());
	const pair = pairReport(); pair.entries.push({ id: '@project', kind: 'project', viewports: [], artifacts: {} });
	pair.findings.push(lintFinding({ runId: undefined, checkId: 'text-difference' }));
	says(pair, 'A lint or a11y finding comes from an absolute check.');
	assert.deepEqual(validateReport(report), []);
});

test('R9.10 and R8.12: a mixed content artifact is judged by the basis of each finding', () => {
	const report = pairReport();
	report.causes.push({ id: 'known', known: true });
	const relative = { id: 'f-t', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'text-difference', layer: 'package', message: 'Text differs.', causeId: 'known' };
	report.findings.push(relative);
	const target = report.entries[0];
	assert.equal(artifactClass(report, target, 'desktop', 'content'), 'explained');
	report.findings.push(headingFinding({ causeId: 'known' }));
	assert.equal(artifactClass(report, target, 'desktop', 'content'), 'unexplained');
	assert.equal(targetClass(report, target), 'unexplained');
	report.findings.pop();
	assert.equal(targetClass(report, target), 'explained');
	target.viewports[0].artifacts.content.state = 'missing';
	assert.equal(artifactClass(report, target, 'desktop', 'content'), null);
	assert.equal(targetState(target), 'missing');
});

test('R8.7 and R9.9: a subject report classifies by state first, then by findings', () => {
	const report = subjectReport();
	const [button, project] = report.entries;
	assert.equal(targetClass(report, button), 'match');
	assert.equal(targetClass(report, project), 'match');
	assert.deepEqual(summarize(report).counts, { match: 2, explained: 0, unexplained: 0, oracle: 0, unclassified: 0, incomplete: 0, total: 2 });
	report.findings.push(axeFinding(), lintFinding());
	assert.equal(targetClass(report, button), 'unexplained');
	assert.equal(targetClass(report, project), 'unexplained');
	assert.equal(artifactClass(report, project, null, 'lint'), 'unexplained');
	assert.equal(cellClass(report, button, 'desktop'), 'unexplained');
	project.artifacts.lint.state = 'failed';
	assert.equal(targetState(project), 'failed');
	assert.equal(artifactClass(report, project, null, 'lint'), null);
	project.artifacts.lint = { state: 'missing', diagnostic: 'No check ran.' };
	report.findings.length = 0;
	assert.equal(targetClass(report, project), null);
	assert.equal(summarize(report).counts.incomplete, 1);
	delete project.artifacts.lint;
	assert.equal(targetState(project), 'missing');
	assert.equal(targetClass(report, project), null);
});

test('ADR 0004 section 7: an absolute finding stays unexplained, whatever its cause', () => {
	const report = subjectReport();
	report.causes.push({ id: 'known', known: true });
	report.findings.push(axeFinding({ causeId: 'known', acceptance: { fingerprint: `sha256:${'a'.repeat(64)}` }, evidenceFingerprint: `sha256:${'a'.repeat(64)}` }));
	assert.equal(targetClass(report, report.entries[0]), 'unexplained');
	const pair = pairReport();
	pair.causes.push({ id: 'known', known: true });
	pair.findings.push(headingFinding({ causeId: 'known' }));
	assert.equal(targetClass(pair, pair.entries[0]), 'unexplained');
});

test('a lint finding on a component counts at target scope, not in each viewport cell', () => {
	const report = subjectReport();
	report.entries[0].artifacts.lint = absolute(['eslint-no-console']);
	report.findings.push(lintFinding({ targetId: 'button' }));
	assert.equal(findingsFor(report, 'button', { viewportId: 'desktop' }).length, 0);
	assert.equal(cellClass(report, report.entries[0], 'desktop'), 'match');
	assert.equal(targetClass(report, report.entries[0]), 'unexplained');
});

test('summary reads a subject report with the same classes as the viewer (Principle 2)', () => {
	const report = subjectReport();
	report.findings.push(axeFinding());
	const result = summarizeReport(report);
	assert.equal(result.pair, null);
	assert.deepEqual(result.subject, { kind: 'single-run', runId: 'run-1' });
	assert.equal(result.verdict, 'unexplained');
	assert.deepEqual(result.targets.map(row => [row.id, row.class]), [['button', 'unexplained'], ['@project', 'match']]);
	assert.deepEqual(result.counts, summarize(report).counts);
	assert.equal(summarizeReport(pairReport()).subject, null);
});

test('adaptV2 adds only what the old file proves and drops nothing', () => {
	const old = { ...pairReport(), schemaVersion: 2, custom: { keep: true } };
	delete old.checks;
	delete old.entries[0].viewports[0].artifacts.content.scope;
	old.entries[0].viewports[0].artifacts.lighthouse = { ...pairContent([]), diff: { ...entryOf('d.json'), changed: true } };
	old.findings.push(
		{ id: 'c1', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'heading-outline', severity: 'warning', message: 'x' },
		{ id: 'c2', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'text-difference', severity: 'warning', message: 'x' },
		{ id: 'b1', targetId: 'home', viewportId: 'desktop', artifact: 'behavior', causeId: null, message: 'menu-2: changed' },
		{ id: 'l1', targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse', cause: 'performance-budget', metric: 'lcp', message: 'x' },
		{ id: 'l2', targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse', cause: 'performance-change', metric: 'lcp', message: 'x' },
		{ id: 's1', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot' });
	const adapted = adaptReport(old);
	assert.equal(adapted.custom.keep, true);
	assert.deepEqual(Object.keys(adapted.checks).sort(), ['behavior', 'heading-outline', 'lighthouse-budget', 'lighthouse-change', 'text-difference']);
	const by = (id) => adapted.findings.find(finding => finding.id === id);
	assert.equal(by('c1').runId, 'run-b');
	assert.equal(by('c2').runId, undefined);
	assert.equal(by('b1').checkId, LEGACY_BEHAVIOR_ID);
	assert.equal(by('l1').runId, 'run-b');
	assert.equal(by('l1').checkId, 'lighthouse-budget');
	assert.equal(by('l2').checkId, 'lighthouse-change');
	assert.equal(by('s1').checkId, undefined);
	assert.equal(adapted.entries[0].viewports[0].artifacts.content.scope, undefined, 'a version 2 file makes no claim about selection');
	assert.equal(targetClass(adapted, adapted.entries[0]), 'unexplained');
	assert.deepEqual(adaptV2(adapted), adapted, 'adapting twice changes nothing');
	assert.ok(!Object.keys(adapted.checks).some(id => id.startsWith('behavior.')), 'the adapter never invents a contract name');
	assert.equal(behaviorCheckId('menu-2'), 'behavior.menu-2');
});

test('an old content finding with an unknown check id fails closed', () => {
	const old = { ...pairReport(), schemaVersion: 2 };
	delete old.checks;
	old.findings.push({ id: 'c1', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'custom-check', message: 'x' });
	assert.throws(() => adaptReport(old), /not in the catalog/);
});

test('the static table of built-in checks matches the check modules', () => {
	assert.deepEqual(Object.keys(BUILTIN_CONTENT_CHECKS).sort(), Object.keys(builtinChecks).sort());
	for (const [id, plugin] of Object.entries(builtinChecks)) {
		assert.equal(plugin.basis, BUILTIN_CONTENT_CHECKS[id].basis, `${id} basis`);
		assert.equal(plugin.title, BUILTIN_CONTENT_CHECKS[id].title, `${id} title`);
		assert.equal(BUILTIN_CONTENT_CHECKS[id].layer, 'package');
	}
	assert.deepEqual(Object.entries(builtinChecks).filter(([, plugin]) => plugin.basis === 'relative').map(([id]) => id), ['text-difference']);
});

test('query reads an absolute artifact at target scope and at viewport scope, and reads no pair', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'report-v3-'));
	try {
		const report = subjectReport();
		report.findings.push(axeFinding(), lintFinding());
		await writeFile(join(dir, 'report.json'), JSON.stringify(report));
		const lint = await queryArtifact(join(dir, 'report.json'), { target: '@project', artifact: 'lint' });
		assert.equal(lint.state, 'complete');
		assert.deepEqual(lint.result, { violations: true, checks: 1 });
		assert.deepEqual(lint.scope, { checks: ['eslint-no-console'] });
		assert.equal(lint.pairKey, null);
		const axe = await queryArtifact(join(dir, 'report.json'), { target: 'button', viewport: 'desktop', artifact: 'a11y' });
		assert.deepEqual(axe.evidence, { run: 'runs/run-1/a11y/axe.json' });
		await assert.rejects(queryArtifact(join(dir, 'report.json'), { target: 'button', artifact: 'content' }), /viewport/);
		await assert.rejects(queryArtifact(join(dir, 'report.json'), { target: 'button', artifact: 'speed' }), /Artifact must be/);
		await assert.rejects(queryArtifact(join(dir, 'report.json'), { target: 'button', viewport: 'desktop', artifact: 'lint' }), /not requested/);
	} finally { await rm(dir, { recursive: true }); }
});

test('record-known refuses a subject report and an absolute finding (R7.3, R9.7)', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'report-v3-'));
	try {
		const subject = subjectReport();
		subject.findings.push(axeFinding());
		await writeFile(join(dir, 'subject.json'), JSON.stringify(subject));
		await writeFile(join(dir, 'config.json'), JSON.stringify({ schemaVersion: 1, sides: { reference: { origin: 'http://localhost:3000' }, test: { origin: 'http://localhost:3001' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 800 }] }));
		const base = { reportPath: join(dir, 'subject.json'), configPath: join(dir, 'config.json'), target: 'button', viewport: 'desktop', artifact: 'content', cause: 'planned', reason: 'Planned.' };
		await assert.rejects(recordKnown(base), /subject report/);
		const pair = pairReport();
		pair.findings.push(headingFinding());
		await writeFile(join(dir, 'pair.json'), JSON.stringify(pair));
		await assert.rejects(recordKnown({ ...base, reportPath: join(dir, 'pair.json'), target: 'home' }), /relative check only/);
	} finally { await rm(dir, { recursive: true }); }
});

test('the query command reaches a lint result without a viewport, and still needs one for the others (R9.9)', async () => {
	assert.doesNotThrow(() => parseCommand(['query', 'report.json', '--target', '@project', '--artifact', 'lint']));
	assert.doesNotThrow(() => parseCommand(['query', 'report.json', '--target', 'button', '--artifact', 'a11y']));
	assert.throws(() => parseCommand(['query', 'report.json', '--target', 'home', '--artifact', 'content']), /query requires/);
	assert.throws(() => parseCommand(['query', 'report.json', '--target', 'home', '--artifact', 'speed']), /query requires/);
	const dir = await mkdtemp(join(tmpdir(), 'report-v3-'));
	try {
		const report = subjectReport();
		report.findings.push(lintFinding());
		await writeFile(join(dir, 'report.json'), JSON.stringify(report));
		let text = '';
		const code = await run(['query', join(dir, 'report.json'), '--target', '@project', '--artifact', 'lint'], { out: { write: (chunk) => { text += chunk; } }, err: { write() {} } });
		assert.equal(code, 0);
		assert.deepEqual(JSON.parse(text).result, { violations: true, checks: 1 });
	} finally { await rm(dir, { recursive: true }); }
});
