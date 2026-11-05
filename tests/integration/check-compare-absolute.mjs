// Needs pngjs and pixelmatch (compareRuns loads them). No browser. The unit suite has no dependency, so this runs in the browser job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns } from '../../src/compare/runs.js';

// Two content-only runs on disk, no browser. Side B has an empty title and a changed text. All data uses example-site.
const snapshot = (title, text) => ({ schemaVersion: 1, extractorVersion: '1.0.0', source: 'settled-dom', title, lang: 'en', text,
	headings: [{ level: 1, text: 'Example site' }], images: [], links: [], omitted: { headings: 0, images: 0, links: 0, text: false } });
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

test('R7.3: an absolute finding carries runId and no evidence fingerprint, and a relative finding the reverse', async () => {
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
		assert.equal(empty.evidenceFingerprint, undefined, 'An absolute finding binds no difference between A and B.');
		const relative = await compareRuns({ runsRoot: runs, runA: 'run-a', runB: 'run-b', outputDir: join(dir, 'relative'), contentChecks: ['text-difference'] });
		assert.equal(relative.report.findings.length, 1);
		const [text] = relative.report.findings;
		assert.equal(text.checkId, 'text-difference');
		assert.equal(text.runId, undefined);
		assert.match(text.evidenceFingerprint, /^sha256:/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
