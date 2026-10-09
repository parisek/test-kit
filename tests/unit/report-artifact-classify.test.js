import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactState, artifactClass, cellState, cellClass, targetState } from '../../src/report/classify.js';

function fixture(artifacts, state = 'complete') {
  const target = { id: 'home', viewports: [{ id: 'desktop', state, artifacts }] };
  return { target, report: { entries: [target], findings: [], causes: [], meta: {} } };
}

test('selected complete visual evidence survives failed sibling checks', () => {
  const { target, report } = fixture({ screenshot: { state: 'complete' }, html: { state: 'complete' },
    content: { state: 'failed' }, behavior: { state: 'missing' } }, 'failed');
  report.findings.push({ targetId: 'home', viewportId: 'desktop', artifact: 'html', message: 'Changed.' });
  assert.equal(artifactState(target, 'desktop', 'screenshot'), 'complete');
  assert.equal(artifactClass(report, target, 'desktop', 'screenshot'), 'match');
  assert.equal(artifactClass(report, target, 'desktop', 'html'), 'unexplained');
  assert.equal(cellState(target, 'desktop'), 'failed');
  assert.equal(cellClass(report, target, 'desktop'), null);
  assert.equal(targetState(target), 'failed');
});

test('unavailable artifacts never receive a passing class', () => {
  for (const state of ['failed', 'missing', 'incompatible']) {
    const { target, report } = fixture({ behavior: { state } });
    assert.equal(artifactState(target, 'desktop', 'behavior'), state);
    assert.equal(artifactClass(report, target, 'desktop', 'behavior'), null);
  }
  const { target, report } = fixture({ html: { state: 'complete' } });
  assert.equal(artifactState(target, 'desktop', 'lighthouse'), 'missing');
  assert.equal(artifactClass(report, target, 'desktop', 'lighthouse'), null);
  assert.equal(artifactState(target, 'mobile', 'html'), 'missing');
});

test('status is unclassified and content needs selected checks before oracle or match', () => {
  const { target, report } = fixture({ status: { state: 'complete' }, content: { state: 'complete', diff: { checks: 0 } } });
  assert.equal(artifactClass(report, target, 'desktop', 'status'), null);
  assert.equal(artifactClass(report, target, 'desktop', 'content'), null);
  target.judge = 'oracle';
  assert.equal(artifactClass(report, target, 'desktop', 'content'), null);
  target.viewports[0].artifacts.content.diff.checks = 2;
  assert.equal(artifactClass(report, target, 'desktop', 'content'), 'oracle');
  delete target.judge;
  assert.equal(artifactClass(report, target, 'desktop', 'content'), 'match');
});

test('behavior and Lighthouse use only their findings and existing known policy', () => {
  for (const artifact of ['behavior', 'lighthouse']) {
    const { target, report } = fixture({ [artifact]: { state: 'complete' }, html: { state: 'failed' } });
    report.causes.push({ id: 'known', known: true });
    report.findings.push({ targetId: 'home', viewportId: 'desktop', artifact, causeId: 'known' },
      { targetId: 'home', viewportId: 'desktop', artifact: 'html' },
      { targetId: 'home', viewportId: 'mobile', artifact });
    assert.equal(artifactClass(report, target, 'desktop', artifact), 'explained');
    report.meta.comparisonPolicyHash = 'sha256:policy';
    assert.equal(artifactClass(report, target, 'desktop', artifact), 'unexplained');
    target.judge = 'oracle';
    assert.equal(artifactClass(report, target, 'desktop', artifact), 'oracle');
    target.viewports[0].artifacts[artifact].state = 'incompatible';
    assert.equal(artifactClass(report, target, 'desktop', artifact), null);
  }
});

test('legacy fallback uses stored cell state without importing sibling failures', () => {
  const { target, report } = fixture({ screenshot: {}, content: { state: 'failed' } });
  assert.equal(artifactClass(report, target, 'desktop', 'screenshot'), 'match');
  target.viewports[0].state = 'missing';
  assert.equal(artifactState(target, 'desktop', 'screenshot'), 'missing');
  target.viewports[0] = { id: 'desktop', ratio: 0 };
  assert.equal(artifactClass(report, target, 'desktop', 'screenshot'), 'match');
  assert.equal(artifactClass(report, target, 'desktop', 'html'), null);
  target.viewports[0].error = 'Capture failed.';
  assert.equal(artifactState(target, 'desktop', 'screenshot'), 'failed');
});

test('recorded acceptance must match selected evidence and pair', () => {
  const { target, report } = fixture({ lighthouse: { state: 'complete' } });
  const fingerprint = `sha256:${'a'.repeat(64)}`;
  const policyHash = `sha256:${'b'.repeat(64)}`;
  report.meta.comparisonPolicyHash = policyHash;
  report.pair = { key: 'pair', aRunId: 'before', bRunId: 'after' };
  report.causes = [{ id: 'approved', known: true, acceptance: 'recorded-evidence' }];
  const finding = { targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse', causeId: 'approved', evidenceFingerprint: fingerprint,
    acceptance: { fingerprint, policyHash, pairKey: 'pair', aRunId: 'before', bRunId: 'after', targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse' } };
  report.findings = [finding];
  report.known_diffs = { pair: [{ target: 'home', viewport: 'desktop', artifact: 'lighthouse', cause: 'approved', fingerprint, evidence: { policyHash } }] };
  assert.equal(artifactClass(report, target, 'desktop', 'lighthouse'), 'explained');
  finding.acceptance.bRunId = 'another-run';
  assert.equal(artifactClass(report, target, 'desktop', 'lighthouse'), 'unexplained');
});
