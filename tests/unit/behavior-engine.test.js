import test from 'node:test';
import assert from 'node:assert/strict';
import { collectContracts, validateContracts, contractApplicability } from '../../src/behavior/contracts.js';
import { compareBehavior, validateBehaviorComparison } from '../../src/behavior/compare.js';
const contract = { name: 'toggle', detect() {}, run() {} };
test('behavior preserves single and multiple upstream contract exports', () => {
  assert.deepEqual(collectContracts(contract), [contract]);
  assert.deepEqual(collectContracts({ first: contract, metadata: 'x' }), [contract]);
  assert.throws(() => validateContracts([contract, contract]), /unique/);
});
test('behavior distinguishes absent library and unapplied pre-navigation settings', () => {
  assert.equal(contractApplicability(contract, { projectName: 'mobile-390' }).state, 'ready');
  assert.equal(contractApplicability(contract, { projectName: 'other' }).state, 'skipped');
  const bound = { ...contract, library: { package: 'example-library', majors: [3] }, emulate: { reducedMotion: 'reduce' } };
  assert.equal(contractApplicability(bound, { projectName: 'mobile-390' }).state, 'incompatible');
  assert.equal(contractApplicability(bound, { projectName: 'mobile-390', libraryVersions: { 'example-library': '3.2.0' } }).state, 'incompatible');
  assert.equal(contractApplicability(bound, { projectName: 'mobile-390', libraryVersions: { 'example-library': '3.2.0' }, emulate: { reducedMotion: 'reduce' } }).state, 'ready');
});
test('behavior aligns missing steps and keeps failures out of same', () => {
  const a = { state: 'complete', settingsHash: 'x', version: '1', steps: [{ id: 'open', title: 'Open', state: 'complete', result: { expanded: true } }] };
  const b = { ...a, steps: [{ ...a.steps[0], state: 'failed', error: 'Not expanded' }, { id: 'close', state: 'complete' }] };
  assert.deepEqual(compareBehavior(a, b).steps.map(step => step.state), ['failed', 'changed']);
  assert.equal(compareBehavior(a, a).steps[0].state, 'same');
  assert.equal(compareBehavior(a, { ...a, settingsHash: 'y' }).state, 'incompatible');
  assert.equal(compareBehavior(a, null).state, 'missing');
});

test('behavior comparison rejects unsafe recordings and forged matching failures', () => {
  const result = { state: 'complete', result: null, evidence: { screenshot: 'behavior/example-site/step.png' } };
  const detail = { state: 'complete', changed: false, steps: [{ id: 'open', title: 'Open', state: 'same', resultA: result, resultB: result }] };
  assert.equal(validateBehaviorComparison(detail), detail);
  assert.throws(() => validateBehaviorComparison({ ...detail, traceA: '../trace.zip' }), /Unsafe/);
  assert.throws(() => validateBehaviorComparison({ ...detail, steps: [{ ...detail.steps[0], resultB: { ...result, state: 'failed' } }] }), /matching/);
  assert.throws(() => validateBehaviorComparison({ ...detail, steps: [detail.steps[0], detail.steps[0]] }), /Duplicate/);
});

test('behavior configuration requires explicit trusted source and known viewport maps', async () => {
  const { normalizeConfig } = await import('../../src/config/normalize.js');
  const config = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8080' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'wide', width: 640, height: 480 }] };
  assert.deepEqual(normalizeConfig(config).artifacts, ['screenshot']);
  assert.throws(() => normalizeConfig({ ...config, artifacts: ['behavior'] }), /trusted source/);
  assert.throws(() => normalizeConfig({ ...config, behavior: { source: '../contracts' } }), /relative/);
  assert.throws(() => normalizeConfig({ ...config, behavior: { source: 'contracts', projects: { absent: 'desktop-1280' } } }), /unknown viewport/);
  assert.equal(normalizeConfig({ ...config, artifacts: ['behavior'], behavior: { source: 'contracts', projects: { wide: 'desktop-1280' }, emulate: { reducedMotion: 'reduce' } } }).behavior.projects.wide, 'desktop-1280');
});
