// Needs pngjs and pixelmatch (compareRuns loads them). No browser. The unit suite has no dependency, so this runs in the browser job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { compareRuns } from '../../src/compare/runs.js';
import { absoluteFingerprints } from '../../src/allowlist/fingerprint.js';
import { targetClass } from '../../src/report/classify.js';
import { summarizeReport } from '../../src/query/summary.js';

// Two content-only runs on disk, no browser. Side B has an empty title and a changed text. All data uses example-site.
const snapshot = (title, text, headings = [{ level: 1, text: 'Example site' }]) => ({ schemaVersion: 1, extractorVersion: '1.1.0', source: 'settled-dom', title, lang: 'en', text,
	headings, images: [], links: [], omitted: { headings: 0, images: 0, links: 0, text: false } });
async function writeRun(root, id, snap) {
	const settings = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:1' } }, targets: [{ id: 'home', kind: 'page', path: '/' }],
		viewports: [{ id: 'wide', width: 640, height: 480 }], artifacts: ['content'], checks: ['empty-title', 'text-difference'], content: { expectedLanguage: 'en' } };
	const path = 'content/home/wide.json.gz';
	await mkdir(join(root, id, 'content/home'), { recursive: true });
	await writeFile(join(root, id, path), gzipSync(JSON.stringify(snap)));
	const content = { state: 'captured', path, tool: 'test-kit-content', version: '1', settingsHash: 'sha256:content', browserVersion: '1' };
	await writeFile(join(root, id, 'run.json'), JSON.stringify({ schemaVersion: 2, id, side: 'local', label: '', at: '2026-01-01T00:00:00.000Z', state: 'complete',
		settings, settingsHash: 'sha256:run', tools: [{ name: 'playwright', version: '1', settingsHash: 'sha256:tool' }],
		captures: [{ targetId: 'home', viewportId: 'wide', state: 'captured', statusCode: 200, artifacts: { content } }] }));
}

test('R7.3 and R9.8: an absolute finding carries runId and the fingerprint of its own evidence, and a relative finding the pair fingerprint and no runId', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'test-kit-absolute-'));
	try {
		const runs = join(dir, 'runs');
		await writeRun(runs, 'run-a', snapshot('Example site', 'Before text'));
		await writeRun(runs, 'run-b', snapshot('', 'After text'));
		const absolute = await compareRuns({ runsRoot: runs, runA: 'run-a', runB: 'run-b', outputDir: join(dir, 'absolute'), contentChecks: ['empty-title'] });
		assert.equal(absolute.report.findings.length, 1);
		assert.equal('project' in absolute.report.meta, false, 'A report carries no project label (#282).');
		const [empty] = absolute.report.findings;
		assert.equal(empty.checkId, 'empty-title');
		assert.equal(empty.runId, 'run-b');
		// R9.8: an absolute finding carries the fingerprint of its own evidence, never of a pair. Its descriptor holds no run id.
		const expected = absoluteFingerprints([{ checkId: 'empty-title', targetId: 'home', viewportId: 'wide', artifact: 'content', message: 'The page title is empty.', evidence: {} }])[0].evidenceFingerprint;
		assert.equal(empty.evidenceFingerprint, expected);
		const relative = await compareRuns({ runsRoot: runs, runA: 'run-a', runB: 'run-b', outputDir: join(dir, 'relative'), contentChecks: ['text-difference'] });
		assert.equal(relative.report.findings.length, 1);
		const [text] = relative.report.findings;
		assert.equal(text.checkId, 'text-difference');
		assert.equal(text.runId, undefined);
		assert.match(text.evidenceFingerprint, /^sha256:/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

const ENTRY = { checkId: 'empty-title', targetId: 'home', reason: 'The title comes from the CMS. Design accepted this.', owner: 'example-team' };
const compare = (dir, a, b, name, extra = {}) => compareRuns({ runsRoot: join(dir, 'runs'), runA: a, runB: b, outputDir: join(dir, name), contentChecks: ['empty-title'], ...extra });

test('R9.8 and R9.12: an allowlisted absolute finding is explained, and a new run of unchanged evidence keeps the entry valid', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'test-kit-allowlist-'));
	try {
		const runs = join(dir, 'runs');
		await writeRun(runs, 'run-a', snapshot('Example site', 'Before text'));
		await writeRun(runs, 'run-b', snapshot('', 'After text'));
		const first = await compare(dir, 'run-a', 'run-b', 'first');
		const [finding] = first.report.findings;
		assert.equal(first.report.allowlist, undefined, 'No entry, no key.');
		assert.equal(targetClass(first.report, first.report.entries[0]), 'unexplained');
		const entry = { ...ENTRY, fingerprint: finding.evidenceFingerprint };
		const explained = await compare(dir, 'run-a', 'run-b', 'explained', { allowlistEntries: [entry] });
		assert.deepEqual(explained.report.allowlist.map((row) => [row.status, row.checkId, row.targetId]), [['active', 'empty-title', 'home']]);
		assert.equal(targetClass(explained.report, explained.report.entries[0]), 'explained');
		assert.equal(summarizeReport(explained.report).counts.explained, 1);
		assert.deepEqual(summarizeReport(explained.report).allowlist, { active: 1, expired: 0, stale: 0, unchecked: 0, 'wrong-basis': 0 });
		// A later run: other run ids, other directory names and other page text, but the same title evidence.
		await writeRun(runs, 'run-c', snapshot('Example site', 'Third text'));
		await writeRun(runs, 'run-d', snapshot('', 'Fourth text, longer than the others'));
		const later = await compare(dir, 'run-c', 'run-d', 'later', { allowlistEntries: [entry] });
		assert.equal(later.report.findings[0].evidenceFingerprint, finding.evidenceFingerprint, 'The fingerprint does not depend on the run.');
		assert.equal(targetClass(later.report, later.report.entries[0]), 'explained');
		const expired = await compare(dir, 'run-a', 'run-b', 'expired', { allowlistEntries: [{ ...entry, expires: '2027-03-31' }], now: new Date('2027-04-01T00:00:00Z') });
		assert.equal(expired.report.allowlist[0].status, 'expired');
		assert.equal(targetClass(expired.report, expired.report.entries[0]), 'unexplained');
		const lasting = await compare(dir, 'run-a', 'run-b', 'lasting', { allowlistEntries: [{ ...entry, expires: '2027-03-31' }], now: new Date('2027-03-31T23:59:59Z') });
		assert.equal(lasting.report.allowlist[0].status, 'active');
		const relative = await compare(dir, 'run-a', 'run-b', 'relative', { contentChecks: ['empty-title', 'text-difference'], allowlistEntries: [{ ...entry, checkId: 'text-difference' }] });
		assert.equal(relative.report.allowlist[0].status, 'wrong-basis');
		assert.equal(relative.report.findings.find((item) => item.checkId === 'text-difference').causeId, undefined);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.8 and R9.12: changed evidence is unexplained again, and its old entry is stale', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'test-kit-allowlist-'));
	try {
		const runs = join(dir, 'runs');
		const h1 = { level: 1, text: 'Example site' };
		await writeRun(runs, 'run-a', snapshot('Example site', 'Text', [h1]));
		await writeRun(runs, 'run-b', snapshot('Example site', 'Text', []));
		await writeRun(runs, 'run-c', snapshot('Example site', 'Text', [h1, h1]));
		const options = { contentChecks: ['heading-outline'] };
		const none = await compare(dir, 'run-a', 'run-b', 'none', options);
		const two = await compare(dir, 'run-a', 'run-c', 'two', options);
		const [zeroFinding] = none.report.findings, [twoFinding] = two.report.findings;
		assert.notEqual(zeroFinding.evidenceFingerprint, twoFinding.evidenceFingerprint, 'Zero and two h1 headings are different evidence.');
		const entry = { checkId: 'heading-outline', targetId: 'home', reason: 'Logo, not a heading.', owner: 'example-team', fingerprint: zeroFinding.evidenceFingerprint };
		const zero = (await compare(dir, 'run-a', 'run-b', 'zero', { ...options, allowlistEntries: [entry] })).report;
		assert.equal(targetClass(zero, zero.entries[0]), 'explained');
		const changed = await compare(dir, 'run-a', 'run-c', 'changed', { ...options, allowlistEntries: [entry] });
		assert.equal(changed.report.allowlist[0].status, 'stale');
		assert.match(changed.report.allowlist[0].diagnostic, new RegExp(twoFinding.evidenceFingerprint));
		assert.equal(targetClass(changed.report, changed.report.entries[0]), 'unexplained');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('R9.12: an invalid allowlist fails the comparison before any output exists', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'test-kit-allowlist-'));
	try {
		const runs = join(dir, 'runs');
		await writeRun(runs, 'run-a', snapshot('Example site', 'Before'));
		await writeRun(runs, 'run-b', snapshot('', 'After'));
		await assert.rejects(compare(dir, 'run-a', 'run-b', 'refused', { allowlistEntries: [{ ...ENTRY, fingerprint: 'nope' }] }), /Invalid allowlist/);
		await assert.rejects(access(join(dir, 'refused')), { code: 'ENOENT' });
		await assert.rejects(compare(dir, 'run-a', 'run-b', 'no-owner', { allowlistEntries: [{ ...ENTRY, owner: undefined, fingerprint: `sha256:${'a'.repeat(64)}` }] }), /owner is required/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
