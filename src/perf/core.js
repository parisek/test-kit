export const METRICS = Object.freeze({ lcp_ms: 'largest-contentful-paint', fcp_ms: 'first-contentful-paint',
  tbt_ms: 'total-blocking-time', cls: 'cumulative-layout-shift', speed_index_ms: 'speed-index' });

// R6.16: the request isolation of a speed run. It enters the settings hash, so two runs with a
// different policy are not compared silently (R6.9). Old runs carry the string of the proxy policy.
export const NETWORK_POLICY_VERSION = 'host-allowlist-v1';
const BLOCK_PATH = /^\/[\x21-\x7e]{0,199}$/;
export function networkPolicy({ allowOrigins = [], blockPaths = [] } = {}) {
  if (!Array.isArray(allowOrigins) || allowOrigins.length > 20 || !Array.isArray(blockPaths) || blockPaths.length > 20) throw new Error('Performance network policy is invalid.');
  const origins = allowOrigins.map(value => {
    let url;
    try { url = new URL(value); } catch { throw new Error('Performance network policy is invalid.'); }
    if (url.protocol !== 'https:' || url.origin !== value) throw new Error('Performance network policy is invalid.');
    return value;
  });
  for (const path of blockPaths) if (typeof path !== 'string' || !BLOCK_PATH.test(path)) throw new Error('Performance network policy is invalid.');
  if (new Set(origins).size !== origins.length || new Set(blockPaths).size !== blockPaths.length) throw new Error('Performance network policy is invalid.');
  return { version: NETWORK_POLICY_VERSION, ...(origins.length ? { allowOrigins: [...origins].sort() } : {}),
    ...(blockPaths.length ? { blockPaths: [...blockPaths].sort() } : {}) };
}

export function performanceSettings({ runs = 3, formFactor = 'desktop', throttling = 'simulated', network } = {}) {
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
    networkPolicy: networkPolicy(network) };
}

// Rebuilds the settings of a stored artifact from its own keys. A run before 1.4 stores the proxy
// policy as a string; it rebuilds to the same string, so its hash still checks, and it never equals a new policy.
export const LEGACY_NETWORK_POLICY = 'loopback-http-get-head-v1';
export function rebuildPerformanceSettings(input) {
  const options = { runs: input?.runs, formFactor: input?.formFactor,
    throttling: input?.throttlingMethod === 'simulate' ? 'simulated' : input?.throttlingMethod };
  const policy = input?.networkPolicy;
  if (policy === LEGACY_NETWORK_POLICY) return { ...performanceSettings(options), networkPolicy: LEGACY_NETWORK_POLICY };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.version !== NETWORK_POLICY_VERSION) throw new Error('Performance network policy is invalid.');
  return performanceSettings({ ...options, network: { allowOrigins: policy.allowOrigins ?? [], blockPaths: policy.blockPaths ?? [] } });
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

