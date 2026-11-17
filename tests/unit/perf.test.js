import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceSettings, performanceConsent, machineLoad, summarizeSamples, comparePerformance, extractMetrics, METRICS, evaluateBudgets, performanceProvenance, rebuildPerformanceSettings, networkPolicy, validatePerformanceSnapshot } from '../../src/perf/model.js';
import { validatePerformanceComparison } from '../../src/perf/schema.js';
const sample = value => Object.fromEntries(Object.keys(METRICS).map(key => [key, value]));
const captured = values => ({ state: 'captured', settingsHash: `sha256:${'a'.repeat(64)}`, version: '13', browserVersion: '145', metrics: summarizeSamples(values.map(sample), values.length) });
test('performance settings fix repeats, emulation, throttle and warm cache', () => {
  assert.equal(performanceSettings().warmup, 1);
  assert.equal(performanceSettings().throttlingMethod, 'simulate');
  assert.equal(performanceSettings().emulatedUserAgent, true);
  assert.equal(performanceSettings().disableStorageReset, true);
  assert.equal(performanceSettings({ formFactor: 'mobile' }).screenEmulation.mobile, true);
  for (const runs of [0, 2, 6, '3']) assert.throws(() => performanceSettings({ runs }));
});
test('aggregation requires all measured metrics and calculates even median and full spread', () => {
  const metric = summarizeSamples([sample(100), sample(120), sample(90), sample(110)], 4).lcp_ms;
  assert.equal(metric.median, 105); assert.equal(metric.spread, 30);
  assert.throws(() => summarizeSamples([sample(1)], 3));
  assert.throws(() => summarizeSamples([sample(1), sample(NaN), sample(3)], 3));
  assert.throws(() => extractMetrics({ runtimeError: { code: 'FAILED' } }));
});
test('cost consent is required beyond three targets and high load needs explicit override', () => {
  assert.throws(() => performanceConsent(4, performanceSettings()), /16 navigations/);
  assert.equal(performanceConsent(4, performanceSettings(), true).measurements, 12);
  assert.throws(() => performanceConsent(1, performanceSettings(), false, { production: true }), /production side/);
  assert.equal(performanceConsent(1, performanceSettings(), true, { production: true }).targets, 1);
  assert.equal(performanceConsent(3, performanceSettings()).targets, 3);
  assert.throws(() => machineLoad(3, 4));
  assert.equal(machineLoad(3, 4, true).suspect, true);
  assert.equal(machineLoad(0.1, 4).suspect, false);
});
test('comparison refuses environment, provenance, suspect and incomplete mismatches', () => {
  const a = captured([100, 110, 120]); const b = captured([200, 210, 220]);
  for (const options of [{ environmentA: 'a', environmentB: 'b' }, {}]) assert.equal(comparePerformance(a, b, options).compatible, false);
  for (const patch of [{ settingsHash: 'other' }, { version: '14' }, { suspect: true }, { state: 'failed' }, { metrics: {} }]) {
    assert.equal(comparePerformance(a, { ...b, ...patch }, { environmentA: 'local', environmentB: 'local' }).compatible, false);
  }
});
test('regressions exceed observed noise and only explicit budgets change exit code', () => {
  const a = captured([100, 110, 120]); const near = captured([105, 115, 125]); const b = captured([200, 210, 220]);
  assert.equal(comparePerformance(a, near, { environmentA: 'local', environmentB: 'local' }).metrics.lcp_ms.state, 'within-noise');
  const options = { environmentA: 'local', environmentB: 'local', budgets: { lcp_ms: 150 } };
  assert.equal(comparePerformance(a, b, options).exitCode, 0);
  const result = comparePerformance(a, b, { ...options, failOnBudget: true });
  assert.equal(result.metrics.lcp_ms.state, 'regression'); assert.equal(result.exitCode, 1); assert.equal(result.findings.filter(finding => finding.cause === 'performance-budget').length, 1);
  assert.equal(result.findings.filter(finding => finding.cause === 'performance-change').length, 5);
  assert.equal(comparePerformance(a, b, { environmentA: 'local', environmentB: 'local', failOnBudget: true }).exitCode, 0);
  const improvement = comparePerformance(b, a, { environmentA: 'local', environmentB: 'local', failOnBudget: true });
  assert.equal(improvement.metrics.lcp_ms.state, 'improvement');
  assert.equal(improvement.findings[0].severity, 'info');
  assert.equal(improvement.exitCode, 0);
});

test('local address guards accept HTTP and HTTPS loopback and reject credentials and nonloopback DNS', async () => {
  const { resolveLocalAddress, isLoopbackAddress } = await import('../../src/perf/network.js');
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('10.0.0.1'), false);
  const local = async () => [{ address: '127.0.0.1' }];
  const remote = async () => [{ address: '203.0.113.1' }];
  assert.equal(await resolveLocalAddress(new URL('http://example-site.ddev.site/'), local), '127.0.0.1');
  assert.equal(await resolveLocalAddress(new URL('https://example-site.ddev.site/'), local), '127.0.0.1');
  for (const url of ['http://user:password@localhost/', 'http://example.com/', 'ftp://localhost/']) {
    await assert.rejects(resolveLocalAddress(new URL(url), local));
  }
  await assert.rejects(resolveLocalAddress(new URL('http://example-site.ddev.site/'), remote));
});

test('the runner pins the first loopback address that answers (CI resolves localhost to ::1 first)', async () => {
  const { reachableLocalAddress } = await import('../../src/perf/network.js');
  const both = async () => [{ address: '::1' }, { address: '127.0.0.1' }];
  const probed = [];
  const probe = async (address, port) => { probed.push([address, port]); return address === '127.0.0.1'; };
  assert.equal(await reachableLocalAddress(new URL('https://localhost:8443/'), { resolver: both, probe }), '127.0.0.1');
  assert.deepEqual(probed, [['::1', 8443], ['127.0.0.1', 8443]]);
  assert.equal(await reachableLocalAddress(new URL('http://localhost/'), { resolver: both, probe: async () => true }), '::1');
  await assert.rejects(reachableLocalAddress(new URL('http://localhost/'), { resolver: both, probe: async () => false }), /does not answer/);
  await assert.rejects(reachableLocalAddress(new URL('http://localhost/'), { resolver: async () => [{ address: '127.0.0.1' }, { address: '203.0.113.1' }], probe }), /loopback/);
});

test('absolute budgets are explicit per-run judgments and reject missing metrics', () => {
  const artifact = captured([100, 110, 120]);
  assert.equal(evaluateBudgets(artifact, { lcp_ms: 90 }).exitCode, 0);
  assert.equal(evaluateBudgets(artifact, { lcp_ms: 90 }, { failOnBudget: true }).exitCode, 1);
  assert.equal(evaluateBudgets({ ...artifact, suspect: true }, { lcp_ms: 90 }).findings.length, 0);
  assert.throws(() => evaluateBudgets(artifact, { unknown: 90 }));
  assert.throws(() => evaluateBudgets({ ...artifact, metrics: {} }, { lcp_ms: 90 }));
});

test('performance snapshots bind settings, summaries and complete report counts', () => {
  const settings = performanceSettings();
  const artifact = { ...captured([100, 110, 120]), kind: 'lighthouse', settings, suspect: false,
    ...performanceProvenance(settings, '13.5.0', 'example-browser'),
    reports: [1, 2, 3].map(index => ({ json: `lighthouse/example-site/${index}.json`, html: `lighthouse/example-site/${index}.html` })) };
  assert.equal(validatePerformanceSnapshot(artifact).metrics.lcp_ms.median, 110);
  assert.throws(() => validatePerformanceSnapshot({ ...artifact, settings: { ...settings, runs: 5 } }));
  assert.throws(() => validatePerformanceSnapshot({ ...artifact, reports: [] }));
  // R6.17: the snapshot keeps valid blocked groups and leaves out a malformed one.
  const kept = validatePerformanceSnapshot({ ...artifact, blocked: [{ resourceType: 'font', origin: 'https://fonts.example.net', count: 1 },
    { resourceType: 'font', origin: 'file:///etc', count: 1 }], blockedOmitted: 2 });
  assert.deepEqual(kept.blocked, [{ resourceType: 'font', origin: 'https://fonts.example.net', count: 1 }]);
  // The left-out group still counts: its request joins blockedOmitted.
  assert.equal(kept.blockedOmitted, 3);
  assert.equal(Object.hasOwn(validatePerformanceSnapshot(artifact), 'blocked'), false);
  assert.throws(() => validatePerformanceSnapshot({ ...artifact, metrics: { ...artifact.metrics, lcp_ms: { ...artifact.metrics.lcp_ms, median: 999 } } }));
});

test('the network policy is canonical, bounded and rebuilds from a stored artifact (R6.9, R6.16)', () => {
  const policy = networkPolicy({ allowOrigins: ['https://b.example.com', 'https://a.example.com'], blockPaths: ['/z', '/a*'] });
  assert.deepEqual(policy, { version: 'host-allowlist-v1', allowOrigins: ['https://a.example.com', 'https://b.example.com'], blockPaths: ['/a*', '/z'] });
  assert.deepEqual(networkPolicy(), { version: 'host-allowlist-v1' });
  for (const input of [{ allowOrigins: ['http://a.example.com'] }, { allowOrigins: ['https://a.example.com/x'] }, { blockPaths: ['no-slash'] },
    { blockPaths: ['/a b'] }, { blockPaths: ['/a', '/a'] }, { allowOrigins: Array.from({ length: 21 }, (_, i) => `https://a${i}.example.com`) }]) {
    assert.throws(() => networkPolicy(input));
  }
  const settings = performanceSettings({ network: { blockPaths: ['/analytics/*'] } });
  assert.deepEqual(rebuildPerformanceSettings(settings), settings);
  // A run of 1.3 keeps its proxy policy string. It rebuilds, and it never equals a new policy.
  const legacy = { ...performanceSettings(), networkPolicy: 'loopback-http-get-head-v1' };
  assert.deepEqual(rebuildPerformanceSettings(legacy), legacy);
  assert.notEqual(performanceProvenance(legacy, '13.6.0', 'b').settingsHash, performanceProvenance(performanceSettings(), '13.6.0', 'b').settingsHash);
  assert.notEqual(performanceProvenance(settings, '13.6.0', 'b').settingsHash, performanceProvenance(performanceSettings(), '13.6.0', 'b').settingsHash);
  assert.throws(() => rebuildPerformanceSettings({ ...settings, networkPolicy: { version: 'other' } }));
});

test('performance comparison validator keeps bounded structured evidence and rejects invalid metrics and findings', () => {
  const settings = performanceSettings();
  const a = captured([100, 110, 120]), b = captured([200, 210, 220]);
  const detail = { ...comparePerformance(a, b, { environmentA: 'local', environmentB: 'local', budgets: { lcp_ms: 150 } }),
    a: { settings, metrics: a.metrics, suspect: false }, b: { settings, metrics: b.metrics, suspect: false } };
  const validated = validatePerformanceComparison(detail);
  assert.equal(validated.metrics.lcp_ms.state, 'regression');
  assert.notEqual(validated.a, detail.a);
  assert.notEqual(validated.metrics.lcp_ms, detail.metrics.lcp_ms);
  const changes = [value => { value.metrics.lcp_ms.delta = Infinity; }, value => { value.metrics.lcp_ms.state = 'same'; },
    value => { value.findings[0].message = 'x'.repeat(1001); }, value => { value.findings = []; },
    value => { value.a.metrics.lcp_ms.samples[0] = NaN; }];
  for (const change of changes) { const malformed = structuredClone(detail); change(malformed); assert.throws(() => validatePerformanceComparison(malformed)); }
  // R6.17: a side may carry its blocked requests. A malformed list fails the whole detail.
  const withBlocked = structuredClone(detail);
  withBlocked.b.blocked = [{ resourceType: 'script', origin: 'https://cdn.example.net', count: 2 }]; withBlocked.b.blockedOmitted = 4;
  assert.deepEqual(validatePerformanceComparison(withBlocked).b.blocked, withBlocked.b.blocked);
  assert.equal(validatePerformanceComparison(withBlocked).b.blockedOmitted, 4);
  for (const change of [value => { value.b.blocked[0].origin = 'javascript:alert(1)'; }, value => { value.b.blocked[0].count = 0; },
    value => { value.b.blockedOmitted = -1; }, value => { value.b.blocked = 'x'; }]) {
    const malformed = structuredClone(withBlocked); change(malformed); assert.throws(() => validatePerformanceComparison(malformed));
  }
  const incompatible = { ...comparePerformance(a, b, { environmentA: 'local', environmentB: 'other' }), a: detail.a, b: detail.b };
  assert.equal(validatePerformanceComparison(incompatible).compatible, false);
});

test('four finite large samples keep a finite median', () => {
  const value = Number.MAX_VALUE;
  assert.equal(summarizeSamples([sample(value), sample(value), sample(value), sample(value)], 4).lcp_ms.median, value);
});
