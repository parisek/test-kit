import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareBehaviorArtifact } from '../../src/behavior/compare-artifact.js';
import { loadBehaviorSource } from '../../src/behavior/source.js';
const directory = await mkdtemp(join(tmpdir(), 'test-kit-behavior-artifact-'));
const hash = createHash('sha256').update('{}').digest('hex');
try {
  const runs = [];
  for (const id of ['a', 'b']) {
    const root = join(directory, 'runs', id, 'behavior', 'example-site', 'desktop');
    await mkdir(root, { recursive: true });
    const snapshot = { tool: 'test-kit-behavior', version: '1', settingsHash: hash, settings: {}, state: id === 'a' ? 'complete' : 'failed', steps: [{ id: 'toggle-1', title: 'Toggle', state: id === 'a' ? 'complete' : 'failed', result: id === 'a' ? { open: true } : null, evidence: { screenshot: 'behavior/example-site/desktop/toggle-1.png' } }] };
    await writeFile(join(root, 'results.json'), JSON.stringify(snapshot));
    await writeFile(join(root, 'toggle-1.png'), 'synthetic-file-bytes');
    runs.push({ id, settings: { viewports: [{ id: 'desktop', width: 1280, height: 900 }] } });
  }
  const index = { state: 'captured', path: 'behavior/example-site/desktop/results.json', tool: 'test-kit-behavior', version: '1', settingsHash: hash, browserVersion: '1' };
  const options = { a: runs[0], b: runs[1], ac: { artifacts: { behavior: index } }, bc: { artifacts: { behavior: index } }, runsRoot: join(directory, 'runs'), output: join(directory, 'report'), targetId: 'example-site', viewportId: 'desktop' };
  const result = await compareBehaviorArtifact(options);
  assert.equal(result.artifact.state, 'failed');
  assert.equal(result.findings[0].severity, 'error');
  const detail = JSON.parse(await readFile(join(options.output, result.artifact.diff.src)));
  assert.equal(detail.steps[0].resultA.evidence.screenshot, 'runs/a/behavior/example-site/desktop/toggle-1.png');
  const incompatible = await compareBehaviorArtifact({ ...options, bc: { artifacts: { behavior: { ...index, browserVersion: '2' } } } });
  assert.equal(incompatible.artifact.state, 'incompatible');
  assert.equal(incompatible.findings.length, 0);
  const failedBrowser = await compareBehaviorArtifact({ ...options, bc: { artifacts: { behavior: { ...index, state: 'failed', browserVersion: '2' } } } });
  assert.equal(failedBrowser.artifact.state, 'incompatible');
  assert.equal(failedBrowser.findings.length, 0);
  await rm(join(directory, 'runs', 'b', 'behavior', 'example-site', 'desktop', 'toggle-1.png'));
  const missingRecordingBrowser = await compareBehaviorArtifact({ ...options, bc: { artifacts: { behavior: { ...index, state: 'failed', browserVersion: '2' } } } });
  assert.equal(missingRecordingBrowser.artifact.state, 'incompatible');
  assert.equal(missingRecordingBrowser.findings.length, 0);
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'package-lock.json'), '{"packages":{}}');
  await mkdir(join(directory, 'contracts'));
  await writeFile(join(directory, 'contracts', 'helper.js'), 'export const enabled = true;');
  await writeFile(join(directory, 'contracts', 'toggle.contract.js'), "import {enabled} from './helper.js'; export const name='toggle'; export async function detect(){return [];} export async function run(){return enabled;}");
  const sourceA = await loadBehaviorSource({ projectRoot: directory, directory: 'contracts' });
  await writeFile(join(directory, 'contracts', 'helper.js'), 'export const enabled = false;');
  assert.match(sourceA.fingerprint, /^[a-f0-9]{64}$/);
  await assert.rejects(loadBehaviorSource({ projectRoot: directory, directory: 'contracts' }), /cached helper/);
  await assert.rejects(loadBehaviorSource({ projectRoot: directory, directory: '../outside' }), /relative/);
  console.log('Behavior adapter: failed evidence, incompatible browser, safe paths and helper fingerprint verified.');
} finally { await rm(directory, { recursive: true, force: true }); }
