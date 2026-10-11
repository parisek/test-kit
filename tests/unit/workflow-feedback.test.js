import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { summarizeRunFeedback } from '../../src/workflow/feedback.js';
async function fixture(t) {
 const root = await mkdtemp(join(tmpdir(), 'test-kit-feedback-')); t.after(() => rm(root, { recursive: true, force: true }));
 const dir = join(root, 'run-1'); await mkdir(dir);
 const run = { id: 'run-1', state: 'complete', side: 'local', settings: { targets: [{ id: 'home', path: '/' }], viewports: [{ id: 'desktop' }], artifacts: ['content', 'behavior'], checks: ['heading-outline', 'empty-alt', 'text-difference'], content: {} }, captures: [{ targetId: 'home', viewportId: 'desktop', state: 'captured', statusCode: 200, artifacts: { content: { state: 'captured', path: 'content.json.gz' }, behavior: { state: 'failed', path: 'behavior.json' } } }] };
 const snapshot = { schemaVersion: 1, extractorVersion: '1.0.0', source: 'settled-dom', title: 'Example', lang: 'en', text: 'Example', headings: [{ level: 1, text: 'Main' }, { level: 3, text: 'Gap' }], images: [{ src: '/image.svg', alt: null, role: '' }], links: [], omitted: { headings: 0, images: 0, links: 0, text: false } };
 await writeFile(join(dir, 'content.json.gz'), gzipSync(JSON.stringify(snapshot)));
 const settings = {}; const behavior = { tool: 'test-kit-behavior', version: '1', settingsHash: createHash('sha256').update(JSON.stringify(settings)).digest('hex'), settings, state: 'failed', steps: [{ id: 'menu-detect', title: 'Detect', state: 'complete' }, { id: 'menu-1', title: 'Menu', state: 'complete' }, { id: 'form-1', title: 'Form', state: 'failed', error: 'Required field is absent.' }, { id: 'drawer', title: 'Drawer', state: 'skipped', reason: 'No marker.' }] };
 await writeFile(join(dir, 'behavior.json'), JSON.stringify(behavior));
 return { root, dir, run };
}
test('single run checks saved content and behavior without an A/B report', async t => {
 const { root, dir, run } = await fixture(t);
 const feedback = await summarizeRunFeedback(run, root);
 assert.equal(feedback.content.checksExecuted, 3); assert.equal(feedback.content.findings, 3); assert.equal(feedback.content.unknown, 1);
 assert.deepEqual(feedback.behavior, { passed: 1, failed: 1, skipped: 1, incompatible: 0, missing: 0 });
 assert.equal(feedback.state, 'incomplete'); assert.equal(feedback.findingCount, 5);
 assert.deepEqual(JSON.parse(await readFile(join(dir, 'feedback.json'))), feedback);
});
test('missing content and behavior do not become passing feedback', async t => {
 const { root, run } = await fixture(t);
 run.captures = [];
 const result = await summarizeRunFeedback(run, root, { persist: false });
 assert.equal(result.state, 'incomplete'); assert.equal(result.content.missing, 1); assert.equal(result.behavior.missing, 1); assert.equal(result.behavior.passed, 0);
});
test('feedback bounds findings and records omitted count', async t => {
 const { root, run } = await fixture(t);
 const result = await summarizeRunFeedback(run, root, { maxFindings: 2, persist: false });
 assert.equal(result.findings.length, 2); assert.equal(result.omittedCount, 3);
});
test('unsafe sidecar paths and compressed oversized content remain missing', async t => {
 const { root, dir, run } = await fixture(t);
 run.captures[0].artifacts.content.path = '../outside.json.gz';
 let result = await summarizeRunFeedback(run, root, { persist: false }); assert.equal(result.content.missing, 1);
 run.captures[0].artifacts.content.path = 'bomb.json.gz';
 await writeFile(join(dir, 'bomb.json.gz'), gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)));
 result = await summarizeRunFeedback(run, root, { persist: false }); assert.equal(result.content.missing, 1);
});

test('detect-only behavior remains missing and does not pass', async t => {
 const { root, dir, run } = await fixture(t);
 const stored = JSON.parse(await readFile(join(dir, 'behavior.json')));
 stored.steps = [{ id: 'menu-detect', title: 'Detect', state: 'complete', result: { instances: 0 } }];
 stored.state = 'missing';
 await writeFile(join(dir, 'behavior.json'), JSON.stringify(stored));
 run.settings.artifacts = ['behavior'];
 run.captures[0].artifacts.behavior.state = 'captured';
 const result = await summarizeRunFeedback(run, root, { persist: false });
 assert.equal(result.state, 'incomplete'); assert.equal(result.behavior.passed, 0); assert.equal(result.behavior.missing, 1);
 assert.equal(result.findings[0].message, 'No behavior assertion completes.');
});
