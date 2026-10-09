// Pure descriptions of the current comparison algorithms.
export function comparatorDescriptor(artifact, rules = {}) {
  if (artifact === 'screenshot') return { name: 'pixelmatch', version: '8.0.0', pipelineVersion: 1,
    settings: { threshold: 0.1, padding: 'white', maxRegions: 8, minPixels: 1 } };
  if (artifact === 'html') return { name: 'test-kit-response', version: '1', pipelineVersion: 1,
    settings: { mode: 'response-window', version: 1, maxLines: 100, maxLineLength: 2000, normalization: Object.entries(rules) },
    normalizer: { version: 1, mode: 'original-literal-spans', maxRules: 50, maxLiteralLength: 2000, maxOccurrences: 20, maxBytes: 2 * 1024 * 1024 } };
  throw new Error('Artifact is not comparable.');
}
