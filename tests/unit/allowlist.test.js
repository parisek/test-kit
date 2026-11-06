import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingsHash } from '../../src/config/settings.js';
import { absoluteFingerprints } from '../../src/allowlist/fingerprint.js';
import { allowlistForReport, allowlistCounts, isAllowlisted, normalizeAllowlist, parseAllowlist } from '../../src/allowlist/model.js';
import { allowlistPath, appendEntry, readAllowlist } from '../../src/allowlist/file.js';
import { recordAllowed } from '../../src/allowlist/record.js';
import { findingIsExplained, targetClass, summarize } from '../../src/report/classify.js';
import { adaptReport, validateReport } from '../../src/report/model.js';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { builtinChecks } from '../../src/checks/index.js';
import { parseCommand, run } from '../../src/cli/run.js';

// R9.8, R9.12, ADR 0004 questions 3 and 4. All data uses example-site.
const HASH = (digit) => `sha256:${digit.repeat(64)}`;
const base = { checkId: 'heading-outline', targetId: 'home', viewportId: 'desktop', artifact: 'content' };

test('R9.8: the worked examples of ADR 0004 give the recorded hashes', () => {
	const hash = (item) => absoluteFingerprints([{ ...base, ...item }])[0].evidenceFingerprint;
	assert.equal(hash({ message: 'The page must have one h1 heading.', evidence: { count: 0 } }),
		'sha256:9a98d2d0b8540446556a080a24b8de1f0e8b9efcb597ae3aeac0157ebfa28d5d');
	assert.equal(hash({ message: 'The page must have one h1 heading.', evidence: { count: 2 } }),
		'sha256:9501b8db43a237cdbcd953720c03d44ab8586fd689bbd2875a98afe857887745');
	const skip = (level, text = 'Příliš žluťoučký kůň') => hash({ message: 'The heading outline skips a level.', evidence: { index: 3, previous: 2, level, text } });
	assert.equal(skip(4), 'sha256:f9c3a0facc89b8253370791af21cfa9ddb1965f319d623c0bea228e31c4a0c7e');
	assert.equal(skip(5), 'sha256:f1839de1251cb3318146c29e8c0a7c56fc498be8188391da850047757bede644');
	assert.equal(skip(4, 'Příliš žluťoučký kůň'.normalize('NFD')), skip(4), 'NFC first: a decomposed text gives the same hash.');
});

test('R9.8: the hash is the settingsHash of the descriptor, and key order does not matter', () => {
	const descriptor = { v: 1, kind: 'absolute-finding', ...base, message: 'm', evidence: { b: 1, a: 2 }, occurrence: 1 };
	const [{ evidenceFingerprint }] = absoluteFingerprints([{ ...base, message: 'm', evidence: { a: 2, b: 1 } }]);
	assert.equal(evidenceFingerprint, settingsHash(descriptor));
	assert.equal(absoluteFingerprints([{ ...base, message: 'm', evidence: { b: 1, a: 2 } }])[0].evidenceFingerprint, evidenceFingerprint);
	assert.equal(absoluteFingerprints([{ ...base, viewportId: null, message: 'm' }])[0].evidenceFingerprint,
		absoluteFingerprints([{ ...base, viewportId: undefined, message: 'm', evidence: {} }])[0].evidenceFingerprint, 'A missing viewport is null and a missing evidence is {}.');
});

test('R9.8: the fingerprint changes with the check, target, viewport, artifact, message and evidence', () => {
	const hash = (item) => absoluteFingerprints([{ ...base, message: 'm', evidence: { n: 1 }, ...item }])[0].evidenceFingerprint;
	const reference = hash({});
	for (const change of [{ checkId: 'lang' }, { targetId: 'about' }, { viewportId: 'mobile' }, { viewportId: null }, { artifact: 'a11y' }, { message: 'other' }, { evidence: { n: 2 } }, { evidence: {} }]) {
		assert.notEqual(hash(change), reference, JSON.stringify(change));
	}
});

test('R9.8: line endings are normalized and -0 is 0, but whitespace is kept', () => {
	const hash = (evidence, message = 'm') => absoluteFingerprints([{ ...base, message, evidence }])[0].evidenceFingerprint;
	assert.equal(hash({ text: 'a\r\nb\rc' }), hash({ text: 'a\nb\nc' }));
	assert.equal(hash({ n: -0 }), hash({ n: 0 }));
	assert.equal(hash({}, 'a\r\nb'), hash({}, 'a\nb'));
	assert.notEqual(hash({ text: 'a b' }), hash({ text: 'a  b' }), 'The producer collapses no whitespace.');
	assert.notEqual(hash({ text: 'a' }), hash({ text: 'a ' }), 'The producer trims nothing.');
});

test('R9.8: a value that cannot be hashed gives no fingerprint and a diagnostic (fails closed)', () => {
	const cycle = {}; cycle.self = cycle;
	const refused = [{ n: NaN }, { n: Infinity }, { n: undefined }, { f: () => 1 }, { n: 10n }, { s: Symbol('x') }, cycle, { text: 'x'.repeat(70 * 1024) }, { list: [1, undefined] }, { when: new Date(0) }];
	for (const evidence of refused) {
		const [result] = absoluteFingerprints([{ ...base, message: 'm', evidence }]);
		assert.equal(result.evidenceFingerprint, undefined);
		assert.match(result.diagnostic, /^No evidence fingerprint: .+ The finding stays unexplained\.$/);
	}
	// The descriptor is level 0 and the evidence is level 1. A container at level 8 passes. A container at level 9 does not.
	const nest = (levels) => { let value = {}; const root = value; for (let level = 1; level < levels; level++) value = value.next = {}; return root; };
	assert.match(absoluteFingerprints([{ ...base, message: 'm', evidence: nest(8) }])[0].evidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
	assert.match(absoluteFingerprints([{ ...base, message: 'm', evidence: nest(9) }])[0].diagnostic, /deeper than 8/);
	assert.equal(absoluteFingerprints([{ ...base, message: 'm', evidence: { text: 'x'.repeat(60 * 1024) } }])[0].diagnostic, undefined);
	assert.equal(absoluteFingerprints([{ ...base, message: 7, evidence: {} }])[0].evidenceFingerprint, undefined);
});

test('R9.8: findings with one descriptor get the occurrence 1, 2, 3 in output order', () => {
	const item = { ...base, message: 'The heading outline skips a level.', evidence: { level: 4 } };
	const other = { ...item, evidence: { level: 5 } };
	const [first, second, different, third] = absoluteFingerprints([item, item, other, item]).map((result) => result.evidenceFingerprint);
	assert.equal(new Set([first, second, different, third]).size, 4);
	assert.equal(first, absoluteFingerprints([item])[0].evidenceFingerprint, 'The first occurrence equals the single finding.');
	assert.equal(second, settingsHash({ v: 1, kind: 'absolute-finding', ...base, message: item.message, evidence: item.evidence, occurrence: 2 }));
	assert.equal(third, settingsHash({ v: 1, kind: 'absolute-finding', ...base, message: item.message, evidence: item.evidence, occurrence: 3 }));
	assert.deepEqual(absoluteFingerprints([null, item]), [{}, { evidenceFingerprint: first }], 'A null item (a relative finding) gets {}.');
});

// A snapshot that makes each absolute built-in check report a finding.
const snapshot = (extra = {}) => ({ schemaVersion: 1, extractorVersion: '1.1.0', source: 'settled-dom', title: '', lang: '', text: 'Example site',
	headings: [{ level: 2, text: 'Intro' }, { level: 4, text: 'Skipped' }], images: [{ src: '/example-site/logo.png', alt: null, role: '' }],
	links: [{ path: '/missing', text: 'Missing' }], omitted: { headings: 0, images: 0, links: 0, text: false }, ...extra });

test('R9.8: the same stored snapshot gives the same fingerprints in any run, for every absolute built-in check', () => {
	const context = (extra) => ({ targetId: 'home', viewportId: 'desktop', expectedLanguage: 'en', responses: { '/missing': 404 }, ...extra });
	const ids = Object.keys(builtinChecks).filter((id) => builtinChecks[id].basis === 'absolute');
	assert.deepEqual(ids.sort(), ['empty-alt', 'empty-title', 'heading-outline', 'internal-links', 'lang']);
	for (const id of ids) {
		const prints = (ctx) => {
			const findings = builtinChecks[id].check(snapshot(), ctx);
			assert.ok(findings.length > 0, `${id} reports a finding on the sample`);
			return absoluteFingerprints(findings.map((finding) => ({ ...finding, artifact: 'content' }))).map((result) => result.evidenceFingerprint);
		};
		const first = prints(context({ runId: 'run-1', runDir: '/tmp/a' })), second = prints(context({ runId: 'run-2', runDir: '/var/b' }));
		assert.deepEqual(first, second, id);
		assert.ok(first.every((value) => /^sha256:/.test(value)), `${id} gives a fingerprint for every finding`);
	}
});

test('R9.12: the allowlist file needs a reason and an owner, and rejects unknown keys, duplicates and bad values', () => {
	const entry = { checkId: 'heading-outline', targetId: 'home', fingerprint: HASH('a'), reason: 'Design accepted this.', owner: 'example-team' };
	const file = (entries) => ({ schemaVersion: 1, entries });
	assert.deepEqual(normalizeAllowlist(file([{ ...entry, expires: '2027-03-31', message: 'm' }])).entries, [{ ...entry, expires: '2027-03-31', message: 'm' }]);
	assert.deepEqual(normalizeAllowlist(file([])).entries, []);
	const bad = [
		[{ ...entry, reason: undefined }, /reason is required/], [{ ...entry, owner: undefined }, /owner is required/],
		[{ ...entry, reason: '  ' }, /reason is required/], [{ ...entry, owner: 'x'.repeat(201) }, /owner is required/], [{ ...entry, reason: 'a\nb' }, /reason is required/],
		[{ ...entry, reason: 'x'.repeat(1001) }, /reason is required/], [{ ...entry, extra: 1 }, /not allowed/], [{ ...entry, fingerprint: 'sha256:abc' }, /fingerprint/],
		[{ ...entry, checkId: '../x' }, /checkId/], [{ ...entry, targetId: 'a/b' }, /targetId/], [{ ...entry, expires: '2027-02-30' }, /expires/], [{ ...entry, expires: '31.03.2027' }, /expires/],
		[{ ...entry, message: 'x'.repeat(301) }, /message/], [null, /must be an object/],
	];
	for (const [value, pattern] of bad) assert.throws(() => normalizeAllowlist(file([value])), pattern, JSON.stringify(value));
	assert.equal(normalizeAllowlist(file([{ ...entry, targetId: '@project' }])).entries[0].targetId, '@project');
	assert.throws(() => normalizeAllowlist(file([entry, { ...entry, reason: 'Again.' }])), /repeats/);
	assert.doesNotThrow(() => normalizeAllowlist(file([entry, { ...entry, targetId: 'about' }, { ...entry, fingerprint: HASH('b') }])));
	assert.throws(() => normalizeAllowlist({ schemaVersion: 2, entries: [] }), /schemaVersion/);
	assert.throws(() => normalizeAllowlist({ schemaVersion: 1, entries: [], extra: true }), /not allowed/);
	assert.throws(() => normalizeAllowlist({ schemaVersion: 1 }), /entries must be an array/);
	const many = Array.from({ length: 501 }, (_, index) => ({ ...entry, fingerprint: `sha256:${String(index).padStart(64, '0')}` }));
	assert.throws(() => normalizeAllowlist(file(many)), /more than 500/);
	assert.equal(normalizeAllowlist(file(many.slice(0, 500))).entries.length, 500);
	assert.throws(() => parseAllowlist(Buffer.from('{')), /not JSON/);
	assert.throws(() => parseAllowlist(Buffer.alloc(1024 * 1024 + 1)), /larger than 1 MB/);
});

// A pair report with one content artifact. `a` is the block under test.
const provenance = { tool: 'example', version: '1', settingsHash: 'sha256:x' };
const content = (state = 'complete', checks = ['heading-outline', 'text-difference']) => ({ state, scope: { checks },
	a: { ...provenance, src: 'a.json' }, b: { ...provenance, src: 'b.json' }, diff: { ...provenance, src: 'd.json', changed: true, checks: checks.length } });
const finding = (extra = {}) => ({ id: 'f1', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'heading-outline', runId: 'run-b', layer: 'package',
	message: 'The page must have one h1 heading.', evidenceFingerprint: HASH('a'), ...extra });
const entryRow = (extra = {}) => ({ checkId: 'heading-outline', targetId: 'home', fingerprint: HASH('a'), reason: 'Design accepted this.', owner: 'example-team', ...extra });
const pairReport = () => ({
	schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }, { id: 'mobile' }] },
	runs: [{ id: 'run-a' }, { id: 'run-b' }], pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' },
	checks: { 'heading-outline': { basis: 'absolute', layer: 'package', title: 'Heading outline' }, 'text-difference': { basis: 'relative', layer: 'package', title: 'Stored text difference' } },
	entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'desktop', state: 'complete', artifacts: { content: content() } }, { id: 'mobile', state: 'complete', artifacts: { content: content() } }], artifacts: {} }],
	causes: [], findings: [], rules: {},
});
const subjectReport = () => ({
	schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'run-1' }], subject: { kind: 'single-run', runId: 'run-1' },
	checks: { 'eslint-no-console': { basis: 'absolute', layer: 'project', title: 'No console call' } },
	entries: [{ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: { lint: { state: 'complete', scope: { checks: ['eslint-no-console'] }, evidence: { ...provenance, src: 'runs/run-1/lint.json' }, result: { violations: true, checks: 1 } } } }],
	causes: [], findings: [{ id: 'l', targetId: '@project', artifact: 'lint', checkId: 'eslint-no-console', runId: 'run-1', layer: 'project', message: 'No console.', location: { file: 'src/example-site/header.js', line: 1 }, evidenceFingerprint: HASH('f') }],
	rules: {},
});
const NOW = new Date('2027-01-15T10:00:00Z');
const withEntries = (report, rows) => ({ ...report, allowlist: allowlistForReport(rows, report, NOW).allowlist });

test('R9.12: findingIsExplained explains an absolute finding only through an active entry with the same fingerprint', () => {
	const report = pairReport();
	report.findings.push(finding());
	assert.equal(findingIsExplained(report, report.findings[0]), false, 'No allowlist: unexplained.');
	const explained = withEntries(report, [entryRow()]);
	assert.equal(explained.allowlist[0].status, 'active');
	assert.equal(findingIsExplained(explained, explained.findings[0]), true);
	assert.deepEqual(validateReport(explained), []);
	assert.equal(targetClass(explained, explained.entries[0]), 'explained');
});

test('R9.12: an allowlisted absolute finding makes its target explained, and changed evidence makes it unexplained again', () => {
	const report = pairReport();
	report.findings.push(finding());
	const explained = withEntries(report, [entryRow()]);
	assert.equal(targetClass(explained, explained.entries[0]), 'explained');
	assert.equal(summarize(explained).counts.explained, 1);
	const changed = pairReport();
	changed.findings.push(finding({ evidenceFingerprint: HASH('b') }));
	const stale = withEntries(changed, [entryRow()]);
	assert.equal(stale.allowlist[0].status, 'stale');
	assert.equal(targetClass(stale, stale.entries[0]), 'unexplained');
	assert.match(stale.allowlist[0].diagnostic, new RegExp(HASH('b')));
});

test('R9.12: only an active entry explains. Expired, stale, unchecked and wrong-basis entries explain nothing', () => {
	const report = pairReport();
	report.findings.push(finding());
	for (const status of ['expired', 'stale', 'unchecked', 'wrong-basis']) {
		const forged = { ...report, allowlist: [{ ...entryRow(), status }] };
		assert.equal(findingIsExplained(forged, forged.findings[0]), false, status);
	}
	const active = { ...report, allowlist: [{ ...entryRow(), status: 'active' }] };
	assert.equal(findingIsExplained(active, active.findings[0]), true);
	for (const change of [{ checkId: 'lang' }, { targetId: 'about' }, { fingerprint: HASH('c') }]) {
		const other = { ...report, allowlist: [{ ...entryRow(), ...change, status: 'active' }] };
		assert.equal(findingIsExplained(other, other.findings[0]), false, JSON.stringify(change));
	}
	const noPrint = { ...active, findings: [finding({ evidenceFingerprint: undefined })] };
	assert.equal(findingIsExplained(noPrint, noPrint.findings[0]), false, 'A finding with no fingerprint is never explained.');
	assert.equal(findingIsExplained({ ...active, allowlist: 'active' }, active.findings[0]), false);
	assert.equal(isAllowlisted({ ...active, checks: undefined }, active.findings[0]), false);
});

test('R7.3 and R9.12: the allowlist never explains a relative finding, and a known cause never explains an absolute one', () => {
	const report = pairReport();
	const relative = { id: 'f2', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'text-difference', layer: 'package', message: 'Text differs.', evidenceFingerprint: HASH('a') };
	report.findings.push(relative);
	const forged = { ...report, allowlist: [{ ...entryRow({ checkId: 'text-difference' }), status: 'active' }] };
	assert.equal(findingIsExplained(forged, relative), false);
	const known = pairReport();
	known.causes.push({ id: 'planned', known: true });
	known.findings.push(finding({ causeId: 'planned' }));
	assert.equal(findingIsExplained(known, known.findings[0]), false);
});

test('R9.12: the status of an entry follows ADR 0004 (wrong-basis, expired, active, stale, unchecked)', () => {
	const report = pairReport();
	report.findings.push(finding({ evidenceFingerprint: HASH('d') }));
	const statuses = (rows, now = NOW, source = report) => allowlistForReport(rows, source, now).allowlist.map((row) => [row.fingerprint.slice(7, 8), row.status]);
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('d') })]), [['d', 'active']]);
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('d'), expires: '2027-01-15' })]), [['d', 'active']], 'An entry lasts to the end of its day in UTC.');
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('d'), expires: '2027-01-14' })]), [['d', 'expired']]);
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('d'), expires: '2027-01-15' })], new Date('2027-01-16T00:00:00Z')), [['d', 'expired']]);
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('e') })]), [['e', 'stale']]);
	assert.deepEqual(statuses([entryRow({ checkId: 'text-difference', fingerprint: HASH('d') })]), [['d', 'wrong-basis']]);
	const gap = pairReport();
	gap.entries[0].viewports[1].artifacts.content.state = 'missing';
	gap.findings.push(finding({ evidenceFingerprint: HASH('d') }));
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('e') })], NOW, gap), [['e', 'unchecked']], 'A gap in one viewport proves nothing.');
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('d') })], NOW, gap), [['d', 'active']], 'A matching finding still counts.');
	const unscoped = pairReport();
	delete unscoped.entries[0].viewports[0].artifacts.content.scope;
	delete unscoped.entries[0].viewports[1].artifacts.content.scope;
	assert.deepEqual(statuses([entryRow({ fingerprint: HASH('e') })], NOW, unscoped), [['e', 'unchecked']], 'An index with no scope makes no claim.');
	const stale = allowlistForReport([entryRow({ fingerprint: HASH('e') })], report, NOW).allowlist[0];
	assert.match(stale.diagnostic, new RegExp(HASH('d')), 'A stale entry lists the fingerprints of the unexplained findings.');
	const fixed = allowlistForReport([entryRow({ fingerprint: HASH('e') })], pairReport(), NOW).allowlist[0];
	assert.match(fixed.diagnostic, /No finding of this check remains/);
});

test('R9.12: the report copies only entries of a known check and target, active first, at most 100', () => {
	const report = pairReport();
	report.findings.push(finding());
	const none = allowlistForReport([entryRow({ checkId: 'unknown-check' }), entryRow({ targetId: 'about' })], report, NOW);
	assert.deepEqual(none, { allowlist: [], omitted: 0 });
	const rows = Array.from({ length: 105 }, (_, index) => entryRow({ fingerprint: `sha256:${String(index + 1).padStart(64, '0')}` }));
	rows.push(entryRow({ fingerprint: HASH('a') }));
	const copied = allowlistForReport(rows, report, NOW);
	assert.equal(copied.allowlist.length, 100);
	assert.equal(copied.omitted, 6);
	assert.equal(copied.allowlist[0].status, 'active', 'An active entry never falls out of the list before a stale one.');
	assert.equal(copied.allowlist[0].fingerprint, HASH('a'));
	assert.deepEqual(allowlistCounts({ allowlist: copied.allowlist }), { active: 1, expired: 0, stale: 99, unchecked: 0, 'wrong-basis': 0 });
});

test('R9.12: the validator checks report.allowlist, in a pair report and in a subject report', () => {
	const says = (report, message) => assert.ok(validateReport(report).includes(message), `${message} in ${JSON.stringify(validateReport(report))}`);
	const report = pairReport();
	report.findings.push(finding());
	const good = withEntries(report, [entryRow()]);
	assert.deepEqual(validateReport(good), []);
	says({ ...good, allowlist: 'x' }, 'allowlist must be an array of at most 100 entries.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], status: 'maybe' }] }, 'An allowlist entry needs a known status.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], reason: '' }] }, 'Invalid allowlist entry.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], extra: 1 }] }, 'Invalid allowlist entry.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], checkId: 'lang' }] }, 'An allowlist entry names a check that is not in the catalog.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], targetId: 'about' }] }, 'An allowlist entry names an unknown target.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], checkId: 'text-difference' }] }, 'An active allowlist entry needs an absolute check.');
	says({ ...good, allowlist: [{ ...good.allowlist[0], diagnostic: 'x'.repeat(1001) }] }, 'An allowlist diagnostic must be bounded text.');
	says({ ...good, findings: [finding({ evidenceFingerprint: 'abc' })] }, 'A finding fingerprint must be a sha256 hash.');
	const subject = subjectReport();
	assert.deepEqual(validateReport(subject), []);
	const allowed = { ...subject, allowlist: allowlistForReport([entryRow({ checkId: 'eslint-no-console', targetId: '@project', fingerprint: HASH('f') })], subject, NOW).allowlist };
	assert.deepEqual(validateReport(allowed), [], 'A subject report may hold the allowlist (R9.7).');
	assert.equal(targetClass(allowed, allowed.entries[0]), 'explained');
	assert.equal(targetClass(subject, subject.entries[0]), 'unexplained');
});

test('R9.12: the allowlist file sits beside the config, a missing file is empty, and an invalid file is an error', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'allowlist-file-'));
	try {
		assert.equal(allowlistPath({ configPath: join(dir, 'test-kit.config.json') }), join(dir, 'test-kit.allowlist.json'));
		assert.equal(allowlistPath({ configPath: join(dir, 'x.json'), override: join(dir, 'other.json') }), join(dir, 'other.json'));
		const file = join(dir, 'test-kit.allowlist.json');
		assert.deepEqual((await readAllowlist(file)).entries, [], 'A missing file is an empty allowlist.');
		await writeFile(file, '{"schemaVersion":1,"entries":[{"checkId":"lang","targetId":"home","fingerprint":"nope","reason":"r","owner":"o"}]}');
		await assert.rejects(readAllowlist(file), /fingerprint/, 'An invalid file never falls back to an empty list.');
		await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
		await assert.rejects(readAllowlist(file), /larger than 1 MB/);
		await assert.rejects(readAllowlist(dir), /not a file/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.12: appendEntry writes by temporary file and rename, adds and never edits, and refuses a duplicate', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'allowlist-append-'));
	try {
		const file = join(dir, 'test-kit.allowlist.json');
		assert.equal(await appendEntry(file, entryRow()), 1);
		assert.equal(await appendEntry(file, entryRow({ fingerprint: HASH('b'), expires: '2027-03-31' })), 2);
		const written = JSON.parse(await readFile(file, 'utf8'));
		assert.equal(written.schemaVersion, 1);
		assert.deepEqual(written.entries.map((entry) => entry.fingerprint), [HASH('a'), HASH('b')]);
		const before = await readFile(file, 'utf8');
		await assert.rejects(appendEntry(file, entryRow({ reason: 'Changed.' })), /already allowlisted/);
		assert.equal(await readFile(file, 'utf8'), before, 'A refused entry leaves the file as it was.');
		await assert.rejects(appendEntry(file, entryRow({ fingerprint: HASH('c'), owner: '' })), /owner/);
		assert.deepEqual(await readdir(dir), ['test-kit.allowlist.json'], 'No temporary file stays.');
		assert.ok((await readFile(file, 'utf8')).endsWith('}\n'));
	} finally { await rm(dir, { recursive: true, force: true }); }
});

const writeReport = async (dir, report, name = 'report.json') => { await writeFile(join(dir, name), JSON.stringify(report)); return join(dir, name); };
const record = (dir, reportPath, extra = {}) => recordAllowed({ reportPath, target: 'home', check: 'heading-outline', viewport: 'desktop', reason: 'Design accepted this.', owner: 'example-team',
	configPath: join(dir, 'test-kit.config.json'), ...extra });

test('R5.3 and R9.12: record-allowed adds one entry for one complete absolute finding, and the next run explains it', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'allowlist-record-'));
	try {
		const report = pairReport();
		report.findings.push(finding({ evidenceFingerprint: HASH('a') }));
		const path = await writeReport(dir, report);
		const result = await record(dir, path, { expires: '2027-03-31' });
		assert.equal(result.fingerprint, HASH('a'));
		assert.equal(result.entries, 1);
		const file = JSON.parse(await readFile(join(dir, 'test-kit.allowlist.json'), 'utf8'));
		assert.deepEqual(file.entries, [{ checkId: 'heading-outline', targetId: 'home', fingerprint: HASH('a'), reason: 'Design accepted this.', owner: 'example-team', expires: '2027-03-31', message: 'The page must have one h1 heading.' }]);
		assert.equal(await readFile(path, 'utf8'), JSON.stringify(report), 'The report is not rewritten.');
		const next = withEntries(report, file.entries);
		assert.equal(targetClass(next, next.entries[0]), 'explained');
		await assert.rejects(record(dir, path), /already allowlisted/, 'A duplicate is refused.');
		await record(dir, path, { allowlist: join(dir, 'custom.json') });
		assert.equal(JSON.parse(await readFile(join(dir, 'custom.json'), 'utf8')).entries.length, 1, '--allowlist overrides the path.');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.12: record-allowed refuses an oracle target, a relative check, an incomplete artifact, a missing or an ambiguous finding, and bad text', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'allowlist-refuse-'));
	try {
		const make = (change) => { const report = pairReport(); report.findings.push(finding()); change?.(report); return report; };
		const refuse = async (change, extra, pattern) => assert.rejects(record(dir, await writeReport(dir, make(change)), extra), pattern);
		await refuse((report) => { report.entries[0].judge = 'oracle'; }, {}, /oracle/);
		await refuse(null, { check: 'text-difference' }, /absolute check only/);
		await refuse(null, { check: 'unknown-check' }, /not in the catalog/);
		await refuse((report) => { report.entries[0].viewports[0].artifacts.content.state = 'missing'; }, {}, /not complete/);
		await refuse(null, { target: 'about' }, /Unknown target/);
		await refuse(null, { viewport: 'tablet' }, /Unknown target viewport/);
		await refuse(null, { viewport: 'mobile' }, /No finding of this check/);
		await refuse(null, { viewport: undefined }, /No finding of this check/);
		await refuse((report) => { report.findings[0].evidenceFingerprint = undefined; report.findings[0].diagnostic = 'No evidence fingerprint: a number is not finite.'; }, {}, /no evidence fingerprint.*not finite/i);
		await refuse((report) => { report.findings.push(finding({ id: 'f2', evidenceFingerprint: HASH('b') })); }, {}, /2 findings match.*sha256:a{64}, sha256:b{64}/);
		await refuse(null, { reason: '' }, /reason/);
		await refuse(null, { owner: 'x'.repeat(201) }, /owner/);
		await refuse(null, { expires: '2027-13-01' }, /expires/);
		await assert.rejects(readdir(dir).then((names) => names.includes('test-kit.allowlist.json') ? Promise.resolve() : Promise.reject(new Error('no file'))), /no file/, 'A refusal writes no allowlist.');
		const subject = subjectReport();
		const result = await recordAllowed({ reportPath: await writeReport(dir, subject, 'subject.json'), target: '@project', check: 'eslint-no-console', reason: 'Legacy file.', owner: 'example-team', configPath: join(dir, 'test-kit.config.json') });
		assert.equal(result.fingerprint, HASH('f'), 'A finding at target scope needs no viewport, and a subject report takes an entry.');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R11.1: summary and query count the entries by status, and only when the report has one', async () => {
	const report = pairReport();
	report.findings.push(finding({ evidenceFingerprint: HASH('a') }));
	const plain = summarizeReport(report);
	assert.equal('allowlist' in plain, false, 'A report without an allowlist keeps the pinned output.');
	const listed = withEntries(report, [entryRow(), entryRow({ fingerprint: HASH('e') }), entryRow({ fingerprint: HASH('f'), expires: '2027-01-01' })]);
	assert.deepEqual(summarizeReport(listed).allowlist, { active: 1, expired: 1, stale: 1, unchecked: 0, 'wrong-basis': 0 });
	assert.deepEqual(summarizeReport(listed, { target: 'home' }).allowlist, { active: 1, expired: 1, stale: 1, unchecked: 0, 'wrong-basis': 0 });
	assert.equal(summarizeReport(listed).counts.explained, 1);
	const subject = subjectReport();
	subject.allowlist = allowlistForReport([entryRow({ checkId: 'eslint-no-console', targetId: '@project', fingerprint: HASH('f') })], subject, NOW).allowlist;
	assert.deepEqual(summarizeReport(subject).allowlist, { active: 1, expired: 0, stale: 0, unchecked: 0, 'wrong-basis': 0 });
	const dir = await mkdtemp(join(tmpdir(), 'allowlist-query-'));
	try {
		const path = await writeReport(dir, subject);
		const answer = await queryArtifact(path, { target: '@project', artifact: 'lint' });
		assert.deepEqual(answer.allowlist, { active: 1, expired: 0, stale: 0, unchecked: 0, 'wrong-basis': 0 });
		const bare = await queryArtifact(await writeReport(dir, subjectReport(), 'bare.json'), { target: '@project', artifact: 'lint' });
		assert.equal('allowlist' in bare, false, 'A report without an allowlist keeps the pinned query output.');
		assert.deepEqual(allowlistCounts(listed, 'home'), { active: 1, expired: 1, stale: 1, unchecked: 0, 'wrong-basis': 0 });
		assert.deepEqual(allowlistCounts(listed, 'about'), { active: 0, expired: 0, stale: 0, unchecked: 0, 'wrong-basis': 0 });
		assert.deepEqual(allowlistCounts({ allowlist: [{ status: 'bogus', targetId: 'home' }, 5] }), { active: 0, expired: 0, stale: 0, unchecked: 0, 'wrong-basis': 0 });
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.12: the command line has record-allowed, and --allowlist belongs to diff and after only', async () => {
	assert.deepEqual(parseCommand(['record-allowed', 'report.json', '--target', 'home', '--check', 'lang', '--reason', 'r', '--owner', 'o']).options,
		{ target: 'home', check: 'lang', reason: 'r', owner: 'o' });
	assert.equal(parseCommand(['record-allowed', 'r.json', '--target', 'a', '--check', 'b', '--reason', 'r', '--owner', 'o', '--viewport', 'v', '--expires', '2027-03-31', '--allowlist', 'x.json', '--config', 'c.json']).options.allowlist, 'x.json');
	for (const missing of ['target', 'check', 'reason', 'owner']) {
		const args = { target: 'a', check: 'b', reason: 'r', owner: 'o' };
		delete args[missing];
		assert.throws(() => parseCommand(['record-allowed', 'r.json', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])]), /requires target, check, reason, and owner/, missing);
	}
	assert.throws(() => parseCommand(['record-allowed']), /requires 1 positional/);
	assert.equal(parseCommand(['diff', 'a', 'b', '--output', 'o', '--allowlist', 'x.json']).options.allowlist, 'x.json');
	assert.equal(parseCommand(['after', '--allowlist', 'x.json']).options.allowlist, 'x.json');
	for (const command of [['run'], ['before'], ['capture', '--side', 'local'], ['record-known', 'r.json']]) assert.throws(() => parseCommand([...command, '--allowlist', 'x.json']), /Unknown option/, command[0]);
	let out = '';
	await run(['--help'], { out: { write: (text) => { out += text; } }, err: { write() {} } });
	assert.match(out, /record-allowed REPORT --target ID --check ID/);
	assert.match(out, /--allowlist FILE/);
});

test('R9.12: adaptReport keeps the allowlist of a report and rejects a bad one', () => {
	const report = pairReport();
	report.findings.push(finding());
	const good = withEntries(report, [entryRow()]);
	assert.equal(adaptReport(good).allowlist.length, 1);
	assert.throws(() => adaptReport({ ...good, allowlist: [{ ...good.allowlist[0], status: 'x' }] }), /Invalid report/);
});
