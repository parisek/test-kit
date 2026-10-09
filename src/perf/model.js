import { isLocalUrl } from '../capture/helpers.js';
import { settingsHash } from '../config/settings.js';
import { METRICS, performanceSettings, summarizeSamples } from './core.js';
export { METRICS, performanceSettings, summarizeSamples } from './core.js';
export { validatePerformanceComparison } from './schema.js';

export function performanceProvenance(settings, version, browserVersion) {
  return { tool: 'lighthouse', version, browserVersion, settingsHash: settingsHash({ settings, browserVersion }) };
}

export function extractMetrics(lhr) {
  if (!lhr || lhr.runtimeError) throw new Error('Lighthouse does not contain a successful measurement.');
  return Object.fromEntries(Object.entries(METRICS).map(([key, id]) => {
    const value = lhr.audits?.[id]?.numericValue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`Lighthouse metric is unavailable: ${key}`);
    return [key, value];
  }));
}

export function performanceConsent(targetCount, settings, consent = false) {
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error('Performance needs at least one target.');
  const measurements = targetCount * settings.runs;
  const navigations = targetCount * (settings.runs + 1);
  if (targetCount > 3 && consent !== true) {
    const error = new Error(`Performance needs ${navigations} navigations (${measurements} measured). Pass explicit cost consent.`);
    error.code = 'PERFORMANCE_COST_CONSENT_REQUIRED';
    error.cost = { targets: targetCount, measurements, navigations };
    throw error;
  }
  return { targets: targetCount, measurements, navigations };
}

export function machineLoad(load, cpuCount, override = false) {
  if (!Number.isFinite(load) || load < 0 || !Number.isInteger(cpuCount) || cpuCount < 1) throw new Error('Machine load is unavailable.');
  const high = load / cpuCount >= 0.75;
  if (high && override !== true) throw new Error('Machine load is high. Wait or use an explicit suspect-run override.');
  return { load, cpuCount, threshold: 0.75, suspect: high };
}

export function evaluateBudgets(artifact, budgets = {}, { failOnBudget = false } = {}) {
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) throw new Error('Performance budgets must be an object.');
  for (const [key, value] of Object.entries(budgets)) {
    if (!Object.hasOwn(METRICS, key) || !Number.isFinite(value) || value < 0) throw new Error(`Invalid performance budget: ${key}`);
  }
  if (!artifact || artifact.state !== 'captured' || artifact.suspect) return { findings: [], exitCode: 0 };
  const findings = [];
  for (const [metric, budget] of Object.entries(budgets)) {
    const value = artifact.metrics?.[metric]?.median;
    if (!Number.isFinite(value) || value < 0) throw new Error(`Performance budget metric is unavailable: ${metric}`);
    if (value > budget) findings.push({ artifact: 'lighthouse', cause: 'performance-budget', severity: 'warning',
      metric, value, budget, message: `${metric} exceeds its budget.` });
  }
  return { findings, exitCode: failOnBudget && findings.length ? 1 : 0 };
}

export function comparePerformance(a, b, { environmentA, environmentB, budgets = {}, failOnBudget = false } = {}) {
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) throw new Error('Performance budgets must be an object.');
  for (const [key, value] of Object.entries(budgets)) {
    if (!Object.hasOwn(METRICS, key) || !Number.isFinite(value) || value < 0) throw new Error(`Invalid performance budget: ${key}`);
  }
  let reason;
  if (!a || !b || a.state !== 'captured' || b.state !== 'captured') reason = 'Measurement is incomplete.';
  else if (!environmentA || environmentA !== environmentB) reason = 'Different environments must not be compared for speed.';
  else if (![a.settingsHash, b.settingsHash].every(value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value))
    || ![a.version, b.version, a.browserVersion, b.browserVersion].every(value => typeof value === 'string' && value.length > 0 && value !== 'unknown')) reason = 'Performance provenance is incomplete.';
  else if (a.settingsHash !== b.settingsHash || a.version !== b.version || a.browserVersion !== b.browserVersion) reason = 'Performance settings or tool versions differ.';
  else if (a.suspect || b.suspect) reason = 'Machine load makes the measurement suspect.';
  const findings = [];
  if (reason) return { compatible: false, reason, metrics: {}, findings, exitCode: 0 };
  const metrics = {};
  for (const key of Object.keys(METRICS)) {
    const left = a.metrics?.[key]; const right = b.metrics?.[key];
    if (!left || !right || ![left.median, right.median, left.spread, right.spread].every(value => Number.isFinite(value) && value >= 0)) {
      return { compatible: false, reason: 'Performance metrics are incomplete.', metrics: {}, findings: [], exitCode: 0 };
    }
    const delta = right.median - left.median;
    const noiseFloor = Math.max(left.spread, right.spread);
    const state = delta > noiseFloor ? 'regression' : delta < -noiseFloor ? 'improvement' : 'within-noise';
    metrics[key] = { a: left, b: right, delta, noiseFloor, state };
    if (state !== 'within-noise') findings.push({ artifact: 'lighthouse', cause: 'performance-change',
      severity: state === 'regression' ? 'warning' : 'info', metric: key, state, delta, noiseFloor,
      message: `${key} ${state} exceeds the observed noise floor.` });
    const budget = budgets[key];
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new Error(`Invalid performance budget: ${key}`);
    if (budget !== undefined && right.median > budget) findings.push({ artifact: 'lighthouse', cause: 'performance-budget',
      severity: 'warning', metric: key, value: right.median, budget, message: `${key} exceeds its budget.` });
  }
  return { compatible: true, metrics, findings, exitCode: failOnBudget && findings.some(finding => finding.cause === 'performance-budget') ? 1 : 0 };
}

export function assertPerformanceNetwork(events, blockedRequests = []) {
  const canonicalUrl = value => {
    try { const url = new URL(value); url.hash = ''; return url.href; } catch { return null; }
  };
  const blockedUrls = new Set(blockedRequests.map(request => canonicalUrl(request.url)).filter(Boolean));
  if (!Array.isArray(events)) throw new Error('Performance request evidence is unavailable.');
  for (const event of events) {
    if (event.method === 'Network.responseReceived' && Object.entries(event.params?.response?.headers ?? {})
      .some(([key, value]) => key.toLowerCase() === 'x-test-kit-proxy-blocked' && String(value) === '1')) {
      throw new Error('Performance proxy blocked a measured page response.');
    }
    if (event.method === 'Network.webSocketCreated') throw new Error('Performance WebSocket request is unsupported.');
    if (event.method !== 'Network.requestWillBeSent') continue;
    const request = event.params?.request;
    const url = new URL(request.url);
    if (blockedUrls.has(canonicalUrl(request.url))) throw new Error('Performance proxy blocked a measured page request.');
    if (['data:', 'blob:'].includes(url.protocol)) continue;
    if (!isLocalUrl(url.href) || url.protocol !== 'http:' || !['GET', 'HEAD'].includes(request.method)) {
      throw new Error('Performance blocked a page request outside the local HTTP policy.');
    }
  }
}

export function validatePerformanceSnapshot(value) {
  if (!value || value.kind !== 'lighthouse' || value.state !== 'captured' || value.tool !== 'lighthouse'
    || typeof value.version !== 'string' || !value.version || value.version.length > 200
    || typeof value.browserVersion !== 'string' || !value.browserVersion || value.browserVersion === 'unknown' || value.browserVersion.length > 200
    || typeof value.suspect !== 'boolean') throw new Error('Invalid performance snapshot provenance.');
  const input = value.settings;
  const settings = performanceSettings({ runs: input?.runs, formFactor: input?.formFactor,
    throttling: input?.throttlingMethod === 'simulate' ? 'simulated' : input?.throttlingMethod });
  if (settingsHash(input) !== settingsHash(settings)
    || performanceProvenance(settings, value.version, value.browserVersion).settingsHash !== value.settingsHash) throw new Error('Performance settings do not match their hash.');
  const samples = Array.from({ length: settings.runs }, (_, index) => Object.fromEntries(Object.keys(METRICS)
    .map(metric => [metric, value.metrics?.[metric]?.samples?.[index]])));
  const metrics = summarizeSamples(samples, settings.runs);
  if (settingsHash(metrics) !== settingsHash(value.metrics)) throw new Error('Performance metrics do not match their samples.');
  if (!Array.isArray(value.reports) || value.reports.length !== settings.runs) throw new Error('Performance raw reports are incomplete.');
  return { kind: 'lighthouse', state: 'captured', tool: value.tool, version: value.version,
    browserVersion: value.browserVersion, settingsHash: value.settingsHash, settings, metrics, suspect: value.suspect,
    ...(value.load && typeof value.load === 'object' ? { load: value.load } : {}), reports: value.reports };
}


