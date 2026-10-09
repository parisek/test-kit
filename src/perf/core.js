export const METRICS = Object.freeze({ lcp_ms: 'largest-contentful-paint', fcp_ms: 'first-contentful-paint',
  tbt_ms: 'total-blocking-time', cls: 'cumulative-layout-shift', speed_index_ms: 'speed-index' });

export function performanceSettings({ runs = 3, formFactor = 'desktop', throttling = 'simulated' } = {}) {
  if (!Number.isInteger(runs) || runs < 3 || runs > 5) throw new Error('Performance needs 3 to 5 measured runs.');
  if (!['desktop', 'mobile'].includes(formFactor)) throw new Error('Performance form factor must be desktop or mobile.');
  if (!['simulated', 'devtools', 'provided'].includes(throttling)) throw new Error('Unknown performance throttling method.');
  const mobile = formFactor === 'mobile';
  return { runs, warmup: 1, formFactor, throttlingMethod: throttling === 'simulated' ? 'simulate' : throttling, disableStorageReset: true,
    onlyCategories: ['performance'], emulatedUserAgent: true, screenEmulation: { mobile, width: mobile ? 390 : 1280,
      height: mobile ? 844 : 900, deviceScaleFactor: 1, disabled: false },
    throttling: mobile ? { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5,
      downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675, cpuSlowdownMultiplier: 4 }
      : { rttMs: 40, throughputKbps: 10240, requestLatencyMs: 0,
        downloadThroughputKbps: 0, uploadThroughputKbps: 0, cpuSlowdownMultiplier: 1 },
    networkPolicy: 'loopback-http-get-head-v1' };
}

export function summarizeSamples(samples, expectedRuns) {
  if (!Array.isArray(samples) || samples.length !== expectedRuns || expectedRuns < 3 || expectedRuns > 5) {
    throw new Error('Performance samples do not match the measured run count.');
  }
  const result = {};
  for (const metric of Object.keys(METRICS)) {
    const values = samples.map(sample => sample[metric]);
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`Missing measured metric: ${metric}`);
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    result[metric] = { median: sorted.length % 2 ? sorted[middle] : sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2,
      min: sorted[0], max: sorted.at(-1), spread: sorted.at(-1) - sorted[0], samples: values };
  }
  return result;
}

