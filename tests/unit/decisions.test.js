import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeDecisions, parseDecisions, decisionsForReport, decisionLabel, isDecided, decisionCounts, validateReportDecisions, MAX_ENTRIES } from '../../src/decisions/model.js';
import { decisionFingerprint, checkFingerprints } from '../../src/decisions/fingerprint.js';
import { decisionsPath, readDecisions, appendDecision } from '../../src/decisions/file.js';
import { recordDecision, designSideOf } from '../../src/decisions/record.js';
import { validateReport } from '../../src/report/model.js';
import { findingIsExplained, targetClass } from '../../src/report/classify.js';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { parseCommand } from '../../src/cli/run.js';

const key = { targetId: 'home', viewportId: 'wide', part: 'card', property: 'layout.gap' };
const entry = (extra = {}) => {
	const value = { ...key, decision: 'report-only', designValue: 24, reason: 'The design leads here.', owner: 'example-team', ...extra };
	return { ...value, fingerprint: extra.fingerprint ?? decisionFingerprint(value) };
};

test('R9.14: the decisions file holds bounded entries, and a bad file never becomes an empty list', () => {
	assert.deepEqual(normalizeDecisions({ schemaVersion: 1, entries: [entry()] }).entries, [entry()]);
	assert.deepEqual(normalizeDecisions({ schemaVersion: 1, entries: [] }).entries, []);
	// The same difference with another design value is a second decision. The same value twice is a duplicate.
	assert.equal(normalizeDecisions({ schemaVersion: 1, entries: [entry(), entry({ designValue: 32 })] }).entries.length, 2);
	assert.throws(() => normalizeDecisions({ schemaVersion: 1, entries: [entry(), entry({ decision: 'implement' })] }), /repeats the difference and the design value/);
	for (const value of [null, [], { entries: [] }, { schemaVersion: 2, entries: [] }, { schemaVersion: 1 }, { schemaVersion: 1, entries: [], other: 1 },
		{ schemaVersion: 1, entries: Array(MAX_ENTRIES + 1).fill(entry()) }, { schemaVersion: 1, entries: [, entry()] }]) assert.throws(() => normalizeDecisions(value), /Invalid decisions/);
	for (const extra of [{ targetId: '../x' }, { viewportId: '' }, { part: 'card[x]' }, { part: '-card' }, { property: 'layout.gap;x' }, { property: 'box' },
		{ decision: 'fix' }, { decision: undefined }, { designValue: {} }, { designValue: Infinity }, { designValue: 'x'.repeat(201) }, { designValue: 'a\nb' },
		{ fingerprint: 'sha256:x' }, { reason: '' }, { reason: 'x'.repeat(1001) }, { owner: ' ' }, { owner: 'a\u0007' }, { message: 'extra key' }]) {
		assert.throws(() => normalizeDecisions({ schemaVersion: 1, entries: [{ ...entry(), ...extra }] }), /Invalid decisions: entry 1/, JSON.stringify(extra));
	}
	const { designValue, ...noValue } = entry();
	assert.throws(() => normalizeDecisions({ schemaVersion: 1, entries: [noValue] }), /designValue/, 'designValue is required, null included.');
	assert.equal(normalizeDecisions({ schemaVersion: 1, entries: [entry({ designValue: null })] }).entries[0].designValue, null);
	assert.throws(() => parseDecisions(Buffer.from('{')), /not JSON/);
	assert.throws(() => parseDecisions(Buffer.alloc(1024 * 1024 + 1)), /larger than 1 MB/);
});

test('R9.14: the fingerprint binds the key and the design value, and a hand edit of either fails the file', () => {
	assert.deepEqual(checkFingerprints([entry()]), [entry()]);
	// The decision, the reason and the owner are not in the fingerprint: a person may change them by hand.
	assert.equal(entry({ decision: 'implement', reason: 'Other.' }).fingerprint, entry().fingerprint);
	for (const change of [{ designValue: 25 }, { designValue: '24' }, { part: 'title' }, { property: 'type.size' }, { viewportId: 'phone' }, { targetId: 'about' }]) {
		assert.notEqual(decisionFingerprint({ ...entry(), ...change }), entry().fingerprint, JSON.stringify(change));
		assert.throws(() => checkFingerprints([{ ...entry(), ...change }]), /fingerprint does not match/, JSON.stringify(change));
	}
});

// The layout differences of one cell, as compareRuns passes them: the design value of each and its fingerprint.
const cellOf = (differences, state = 'complete') => ({ state, differences: differences.map(([part, property, designValue]) => ({ part, property, designValue,
	fingerprint: decisionFingerprint({ ...key, part, property, designValue }) })) });
const cells = (cell) => new Map([['home\u0000wide', cell]]);

test('R9.14: the producer decides each status once: active, stale when the design value moved, absent, unchecked', () => {
	const status = (cell, rows = [entry()]) => decisionsForReport(rows, cells(cell)).decisions.map(item => [item.status, item.diagnostic ?? null]);
	assert.deepEqual(status(cellOf([['card', 'layout.gap', 24]])), [['active', null]]);
	assert.deepEqual(status(cellOf([['card', 'layout.gap', 32]])), [['stale', 'The design value moved: recorded 24, now 32. Decide again.']]);
	assert.deepEqual(status(cellOf([['card', 'type.size', 24]])), [['absent', 'No layout difference has this key in this report.']]);
	assert.deepEqual(status(cellOf([['card', 'layout.gap', 24]], 'failed')), [['unchecked', 'The layout artifact of this cell is not complete, so the entry proves nothing.']]);
	// An entry whose cell the report does not compare is not copied.
	assert.deepEqual(decisionsForReport([entry({ viewportId: 'phone', fingerprint: undefined })], cells(cellOf([]))).decisions, []);
	// Active entries come first, and the copy holds at most 100 entries.
	const many = Array.from({ length: 120 }, (_, index) => entry({ designValue: index }));
	const decided = decisionsForReport(many, cells(cellOf([['card', 'layout.gap', 110]])));
	assert.equal(decided.decisions.length, 100);
	assert.equal(decided.omitted, 20);
	assert.equal(decided.decisions[0].status, 'active');
	assert.equal(decided.decisions[0].designValue, 110);
	// A label prefers the active entry of the key, else a stale one. A label never explains.
	const both = decisionsForReport([entry({ designValue: 16, decision: 'implement' }), entry()], cells(cellOf([['card', 'layout.gap', 24]]))).decisions;
	assert.deepEqual(decisionLabel(both, { ...key, fingerprint: entry().fingerprint }), { decision: 'report-only', status: 'active' });
	assert.deepEqual(decisionLabel(both, { ...key, fingerprint: decisionFingerprint({ ...key, designValue: 99 }) }), { decision: 'implement', status: 'stale' });
	assert.equal(decisionLabel(both, { ...key, part: 'title', fingerprint: entry().fingerprint }), null);
});

// A convergence report: run A is the design side, run B the site. One layout cell with two differences.
const provenance = { tool: 'test-kit-layout', version: '1.0.0', settingsHash: 'sha256:x' };
const layoutIndex = (differences, state = 'complete') => ({ kind: 'layout', state, scope: { checks: ['layout'] },
	a: { ...provenance, kind: 'layout', src: 'runs/design/layout/home/wide.json' }, b: { ...provenance, kind: 'layout', src: 'runs/site/layout/home/wide.json' },
	diff: { kind: 'layout', src: 'diff/layout/home/wide.json', tool: 'test-kit-layout-compare', version: '1.0.0', settingsHash: 'sha256:y', changed: differences.length > 0, checks: 1,
		counts: { parts: 2, match: 0, differs: 2, missing: 0, count: 0, differences: differences.length }, differences, differencesOmitted: 0 } });
const DIFFERENCES = [{ part: 'card', property: 'layout.gap', kind: 'differs', a: 24, b: 16, tokenA: '--space-6', tokenB: '--spacing-4' }, { part: 'title', property: 'type.size', kind: 'differs', a: 36, b: 28 }];
const layoutFinding = (item, index, decisions = []) => {
	const designFingerprint = decisionFingerprint({ ...key, part: item.part, property: item.property, designValue: item.a });
	const label = decisionLabel(decisions, { ...key, part: item.part, property: item.property, fingerprint: designFingerprint });
	return { id: `layout-home-wide-${index}`, targetId: 'home', viewportId: 'wide', artifact: 'layout', checkId: 'layout', layer: 'package', severity: 'warning',
		message: `Layout part ${item.part} ${item.property}.`, part: item.part, property: item.property, designFingerprint, ...(label ? { decision: label } : {}) };
};
const convergence = (rows = [], differences = DIFFERENCES) => {
	const decisions = decisionsForReport(rows, cells(cellOf(differences.map(item => [item.part, item.property, item.a])))).decisions;
	return {
		schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'wide' }] },
		runs: [{ id: 'design', side: 'design', settings: { sides: { design: { kind: 'design', provider: 'claude-design', root: 'canvas' } } } },
			{ id: 'site', side: 'site', settings: { sides: { site: { origin: 'http://127.0.0.1:1' } } } }],
		pair: { kind: 'convergence', aRunId: 'design', bRunId: 'site' },
		checks: { layout: { basis: 'relative', layer: 'package', title: 'Layout record difference' } },
		entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'wide', state: 'complete', artifacts: { layout: layoutIndex(differences) } }], artifacts: {} }],
		causes: [], findings: differences.map((item, index) => layoutFinding(item, index, decisions)), rules: {}, ...(decisions.length ? { decisions } : {}),
	};
};
const gapEntry = (extra = {}) => entry({ designValue: 24, ...extra });
const sizeEntry = (extra = {}) => entry({ part: 'title', property: 'type.size', designValue: 36, decision: 'implement', ...extra });

test('R9.14: only an active report-only decision for the same design value explains a layout finding; implement labels', () => {
	const none = convergence();
	assert.deepEqual(validateReport(none), []);
	assert.equal(none.findings.some(item => findingIsExplained(none, item)), false);
	const report = convergence([gapEntry(), sizeEntry()]);
	assert.deepEqual(validateReport(report), []);
	const [gap, size] = report.findings;
	assert.deepEqual([gap.decision, size.decision], [{ decision: 'report-only', status: 'active' }, { decision: 'implement', status: 'active' }]);
	assert.equal(findingIsExplained(report, gap), true, 'report-only for the same design value explains.');
	assert.equal(findingIsExplained(report, size), false, 'implement never explains.');
	assert.equal(targetClass(report, report.entries[0]), 'unexplained', 'One unexplained finding keeps the target unexplained.');
	// The binding bites: the design moved the gap to 32, so the recorded entry is stale and the finding asks again.
	const moved = convergence([gapEntry(), sizeEntry()], [{ ...DIFFERENCES[0], a: 32 }, DIFFERENCES[1]]);
	assert.equal(moved.decisions.find(item => item.part === 'card').status, 'stale');
	assert.deepEqual(moved.findings[0].decision, { decision: 'report-only', status: 'stale' });
	assert.equal(findingIsExplained(moved, moved.findings[0]), false);
	// Fail closed: a label alone, another fingerprint, a stale status or a subject report never explain.
	assert.equal(isDecided({ ...report, decisions: [] }, gap), false);
	assert.equal(isDecided(report, { ...gap, designFingerprint: decisionFingerprint({ ...key, designValue: 99 }) }), false);
	assert.equal(isDecided({ ...report, decisions: report.decisions.map(item => ({ ...item, status: 'stale' })) }, gap), false);
	assert.equal(isDecided({ ...report, pair: undefined, subject: { kind: 'single-run', runId: 'site' } }, gap), false);
	assert.equal(isDecided(report, { ...gap, artifact: 'html' }), false);
	// With every finding report-only, the target is explained.
	const all = convergence([gapEntry(), sizeEntry({ decision: 'report-only' })]);
	assert.equal(targetClass(all, all.entries[0]), 'explained');
	assert.deepEqual(decisionCounts(all), { active: 2, stale: 0, absent: 0, unchecked: 0 });
	assert.deepEqual(summarizeReport(all).decisions, { active: 2, stale: 0, absent: 0, unchecked: 0 });
	assert.equal(summarizeReport(none).decisions, undefined, 'A report without a decision adds no summary key.');
});

test('R9.14: the report validator checks the decisions copy and the decision keys of a finding', () => {
	const problems = (change) => { const report = convergence([gapEntry()]); change(report); const out = []; validateReportDecisions(report, { targetIds: new Set(['home']), viewportIds: new Set(['wide']) }, out); return out; };
	assert.deepEqual(problems(() => {}), []);
	for (const change of [
		report => { report.decisions[0].status = 'done'; }, report => { report.decisions[0].targetId = 'about'; }, report => { report.decisions[0].viewportId = 'phone'; },
		report => { report.decisions[0].extra = 1; }, report => { report.decisions = {}; }, report => { report.decisions = Array(101).fill(report.decisions[0]); },
		report => { report.pair = undefined; }, report => { report.meta.decisionsOmitted = 0; },
		report => { report.findings[0].designFingerprint = 'x'; }, report => { report.findings[0].part = '../x'; }, report => { report.findings[0].property = 'x y'; },
		report => { report.findings[0].decision = { decision: 'report-only', status: 'absent' }; }, report => { report.findings[0].decision = { decision: 'fix', status: 'active' }; },
		report => { report.findings[0].decision = { decision: 'report-only', status: 'active', extra: 1 }; },
	]) assert.notDeepEqual(problems(change), [], String(change));
});

test('R9.14: the design value comes from the design side; in a drift pair from run B', () => {
	const report = convergence();
	assert.equal(designSideOf(report), 'a');
	const design = report.runs[0].settings;
	const browser = report.runs[1].settings;
	assert.equal(designSideOf({ ...report, runs: [{ id: 'design', side: 'site', settings: browser }, { id: 'site', side: 'design', settings: design }] }), 'b', 'The site as A, the design as B.');
	assert.equal(designSideOf({ ...report, runs: [{ ...report.runs[0] }, { id: 'site', side: 'design', settings: design }] }), 'b', 'Two design runs: run B is the newer import.');
	assert.equal(designSideOf({ ...report, runs: [{ id: 'design', side: 'site', settings: report.runs[1].settings }, report.runs[1]] }), null);
});

const writeConvergence = async (dir, report = convergence()) => {
	await mkdir(join(dir, 'diff/layout/home'), { recursive: true });
	const differences = report.entries[0].viewports[0].artifacts.layout.diff.differences;
	await writeFile(join(dir, 'diff/layout/home/wide.json'), JSON.stringify({ changed: differences.length > 0, parts: [{ id: 'card', state: 'differs' }, { id: 'title', state: 'differs' }],
		differences, counts: { parts: 2, match: 0, differs: 2, missing: 0, count: 0, differences: differences.length }, differencesOmitted: 0 }));
	await writeFile(join(dir, 'report.json'), JSON.stringify(report));
	return join(dir, 'report.json');
};

test('R5.3 and R9.14: record-decision adds one entry bound to the design value; the file stays the only state', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'decisions-record-'));
	try {
		const reportPath = await writeConvergence(dir);
		const configPath = join(dir, 'test-kit.config.json');
		const record = (extra = {}) => recordDecision({ reportPath, target: 'home', viewport: 'wide', part: 'card', property: 'layout.gap', decision: 'report-only',
			reason: 'The design leads here.', owner: 'example-team', configPath, ...extra });
		const result = await record();
		assert.equal(result.designValue, 24, 'The value comes from run A, the design side of this pair.');
		assert.equal(result.fingerprint, gapEntry().fingerprint);
		assert.equal(result.decisions, decisionsPath({ configPath }));
		const file = JSON.parse(await readFile(join(dir, 'test-kit.decisions.json'), 'utf8'));
		assert.deepEqual(file, { schemaVersion: 1, entries: [gapEntry()] });
		await assert.rejects(record({ decision: 'implement' }), /already has a decision for this design value/);
		await record({ part: 'title', property: 'type.size', decision: 'implement' });
		assert.deepEqual((await readDecisions(join(dir, 'test-kit.decisions.json'))).entries.map(item => [item.part, item.decision, item.designValue]), [['card', 'report-only', 24], ['title', 'implement', 36]]);
		await record({ decisions: join(dir, 'other.json') });
		assert.equal(JSON.parse(await readFile(join(dir, 'other.json'), 'utf8')).entries.length, 1, '--decisions overrides the path.');
		assert.deepEqual((await readdir(dir)).sort(), ['diff', 'other.json', 'report.json', 'test-kit.decisions.json'], 'No temporary file stays.');
		// Refusals: bad text first, then the report.
		await assert.rejects(record({ decision: 'fix' }), /Invalid decision: decision must be implement or report-only/);
		await assert.rejects(record({ reason: '' }), /Invalid decision: reason/);
		await assert.rejects(record({ property: 'paint.color' }), /No layout difference of this cell has this part and property/);
		await assert.rejects(record({ viewport: 'phone' }), /Unknown target viewport/);
		await assert.rejects(record({ target: 'about' }), /Unknown target/);
		const site = convergence();
		site.runs[0] = { ...site.runs[0], settings: { sides: { design: { origin: 'http://127.0.0.1:2' } } } };
		await writeFile(join(dir, 'browser.json'), JSON.stringify(site));
		await assert.rejects(record({ reportPath: join(dir, 'browser.json') }), /no design run/);
		const failed = convergence();
		failed.entries[0].viewports[0].artifacts.layout.state = 'failed';
		failed.entries[0].viewports[0].artifacts.layout.diagnostic = 'A layout file is missing.';
		failed.entries[0].viewports[0].state = 'failed';
		await writeFile(join(dir, 'failed.json'), JSON.stringify(failed));
		await assert.rejects(record({ reportPath: join(dir, 'failed.json') }), /not complete/);
		// An invalid file fails the command before any write.
		await writeFile(join(dir, 'bad.json'), JSON.stringify({ schemaVersion: 1, entries: [{ ...gapEntry(), designValue: 99 }] }));
		await assert.rejects(record({ part: 'title', property: 'type.size', decisions: join(dir, 'bad.json') }), /fingerprint does not match/);
		await assert.rejects(readDecisions(join(dir, 'bad.json')), /fingerprint does not match/);
		assert.deepEqual(await readDecisions(join(dir, 'missing.json')), { entries: [], bytes: null }, 'A missing file is an empty list.');
		// The query labels each listed difference with the decision of its key.
		const decided = convergence([gapEntry(), sizeEntry()]);
		const path = await writeConvergence(dir, decided);
		const query = await queryArtifact(path, { target: 'home', viewport: 'wide', artifact: 'layout' });
		assert.deepEqual(query.decisions, { active: 2, stale: 0, absent: 0, unchecked: 0 });
		assert.deepEqual(query.diff.differences.map(item => item.decision), [{ decision: 'report-only', status: 'active' }, { decision: 'implement', status: 'active' }]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.14: appendDecision allows a second design value for one difference and never edits an entry', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'decisions-file-'));
	try {
		const file = join(dir, 'test-kit.decisions.json');
		assert.equal(await appendDecision(file, gapEntry()), 1);
		assert.equal(await appendDecision(file, gapEntry({ designValue: 32, decision: 'implement' })), 2);
		const before = await readFile(file, 'utf8');
		await assert.rejects(appendDecision(file, gapEntry({ reason: 'Again.' })), /already has a decision/);
		assert.equal(await readFile(file, 'utf8'), before, 'A refused entry leaves the file as it was.');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

// R9.14: the decisions file is a regular file. A symbolic link, a FIFO and a directory are refused before any read,
// so a FIFO cannot hang `diff` or `record-decision`. The timeout turns a hang into a failure.
test('R9.14: the decisions file must be a regular file; a symbolic link, a FIFO and a directory are refused', { timeout: 10_000 }, async () => {
	const dir = await mkdtemp(join(tmpdir(), 'test-kit-decisions-file-'));
	try {
		const real = join(dir, 'real.json');
		const content = `${JSON.stringify({ schemaVersion: 1, entries: [entry()] }, null, 2)}\n`;
		await writeFile(real, content);
		assert.equal((await readDecisions(real)).entries.length, 1, 'A regular file reads.');
		const notRegular = /not a regular file/;
		if (process.platform !== 'win32') {
			const link = join(dir, 'link.json');
			await symlink(real, link);
			await assert.rejects(readDecisions(link), notRegular);
			await assert.rejects(appendDecision(link, entry({ designValue: 32 })), notRegular);
			assert.equal(await readFile(real, 'utf8'), content, 'A refused write leaves the target of the link unchanged.');
			const fifo = join(dir, 'fifo.json');
			execFileSync('mkfifo', [fifo]);
			await assert.rejects(readDecisions(fifo), notRegular);
			await assert.rejects(appendDecision(fifo, entry({ designValue: 32 })), notRegular);
		}
		await mkdir(join(dir, 'folder.json'));
		await assert.rejects(readDecisions(join(dir, 'folder.json')), notRegular);
		assert.deepEqual(await readDecisions(join(dir, 'missing.json')), { entries: [], bytes: null }, 'A missing file is still an empty list.');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('cli: record-decision and diff --decisions', () => {
	const parsed = parseCommand(['record-decision', 'r.json', '--target', 'home', '--viewport', 'wide', '--part', 'card', '--property', 'layout.gap', '--decision', 'report-only', '--reason', 'x', '--owner', 'y', '--decisions', 'd.json']);
	assert.equal(parsed.options.decision, 'report-only');
	assert.throws(() => parseCommand(['record-decision', 'r.json', '--target', 'home', '--viewport', 'wide', '--part', 'card', '--property', 'layout.gap', '--decision', 'fix', '--reason', 'x', '--owner', 'y']), /record-decision requires/);
	assert.throws(() => parseCommand(['record-decision', 'r.json', '--target', 'home', '--part', 'card', '--property', 'layout.gap', '--decision', 'implement', '--reason', 'x', '--owner', 'y']), /record-decision requires/);
	assert.equal(parseCommand(['diff', 'a', 'b', '--output', 'o', '--decisions', 'd.json']).options.decisions, 'd.json');
	assert.throws(() => parseCommand(['after', '--decisions', 'd.json']), /Unknown option/);
});
