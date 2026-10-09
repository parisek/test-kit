import { METRICS, performanceSettings, summarizeSamples } from './core.js';

function structural(value) {
  const canonical = input => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])]));
    return input;
  };
  return JSON.stringify(canonical(value));
}

export function validatePerformanceComparison(value) {
  const fail = () => { throw new Error('Invalid performance comparison.'); };
  const object = input => input && typeof input === 'object' && !Array.isArray(input);
  const finite = input => typeof input === 'number' && Number.isFinite(input);
  const text = (input, maximum = 1000) => typeof input === 'string' && input.length > 0 && input.length <= maximum && !/[\x00-\x1f\x7f]/.test(input);
  const side = input => {
    if (!object(input) || typeof input.suspect !== 'boolean' || !object(input.settings) || !object(input.metrics)) return fail();
    const settings = performanceSettings({ runs: input.settings.runs, formFactor: input.settings.formFactor,
      throttling: input.settings.throttlingMethod === 'simulate' ? 'simulated' : input.settings.throttlingMethod });
    if (structural(settings) !== structural(input.settings)) return fail();
    const samples = Array.from({ length: settings.runs }, (_, index) => Object.fromEntries(Object.keys(METRICS)
      .map(metric => [metric, input.metrics[metric]?.samples?.[index]])));
    const metrics = summarizeSamples(samples, settings.runs);
    if (structural(metrics) !== structural(input.metrics)) return fail();
    return { settings, metrics, suspect: input.suspect };
  };
  if (!object(value) || typeof value.compatible !== 'boolean' || !object(value.metrics)
    || !Array.isArray(value.findings) || value.findings.length > 20 || ![0, 1].includes(value.exitCode)) return fail();
  const a = side(value.a), b = side(value.b);
  const metrics = {};
  if (value.compatible) {
    if (a.suspect || b.suspect || structural(a.settings) !== structural(b.settings)
      || Object.keys(value.metrics).length !== Object.keys(METRICS).length) return fail();
    for (const metric of Object.keys(METRICS)) {
      const input = value.metrics[metric];
      if (!object(input) || !finite(input.delta) || !finite(input.noiseFloor) || input.noiseFloor < 0
        || !['regression', 'improvement', 'within-noise'].includes(input.state)) return fail();
      const delta = b.metrics[metric].median - a.metrics[metric].median;
      const noiseFloor = Math.max(a.metrics[metric].spread, b.metrics[metric].spread);
      const state = delta > noiseFloor ? 'regression' : delta < -noiseFloor ? 'improvement' : 'within-noise';
      if (input.delta !== delta || input.noiseFloor !== noiseFloor || input.state !== state
        || structural(input.a) !== structural(a.metrics[metric]) || structural(input.b) !== structural(b.metrics[metric])) return fail();
      metrics[metric] = { a: a.metrics[metric], b: b.metrics[metric], delta, noiseFloor, state };
    }
  } else if (!text(value.reason) || Object.keys(value.metrics).length || value.findings.length || value.exitCode !== 0) return fail();
  const findings = value.findings.map(input => {
    if (!object(input) || input.artifact !== 'lighthouse' || !Object.hasOwn(METRICS, input.metric)
      || !['performance-change', 'performance-budget'].includes(input.cause)
      || !['warning', 'info'].includes(input.severity) || !text(input.message)) return fail();
    const base = { artifact: 'lighthouse', cause: input.cause, severity: input.severity, metric: input.metric, message: input.message };
    if (input.cause === 'performance-change') {
      const metric = metrics[input.metric];
      if (!metric || metric.state === 'within-noise' || input.state !== metric.state || input.delta !== metric.delta
        || input.noiseFloor !== metric.noiseFloor || input.severity !== (metric.state === 'regression' ? 'warning' : 'info')) return fail();
      return { ...base, state: input.state, delta: metric.delta, noiseFloor: metric.noiseFloor };
    }
    if (!finite(input.budget) || input.budget < 0 || !finite(input.value) || input.value !== b.metrics[input.metric].median
      || input.value <= input.budget || input.severity !== 'warning') return fail();
    return { ...base, budget: input.budget, value: input.value };
  });
  for (const [metric, result] of Object.entries(metrics)) {
    if (result.state !== 'within-noise' && !findings.some(finding => finding.cause === 'performance-change' && finding.metric === metric)) return fail();
  }
  if (value.exitCode === 1 && !findings.some(finding => finding.cause === 'performance-budget')) return fail();
  return { compatible: value.compatible, ...(value.compatible ? {} : { reason: value.reason }), metrics, a, b, findings, exitCode: value.exitCode };
}
