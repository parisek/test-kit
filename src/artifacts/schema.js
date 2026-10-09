import { validatePerformanceComparison } from '../perf/schema.js';
import { validateBehaviorComparison } from '../behavior/compare.js';
import { validateContentComparison } from '../content/compare.js';
import { isHash } from '../rules/model.js';
function integer(value, max = 2 * 1024 * 1024) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function path(value) { return typeof value === 'string' && value.length <= 2000 && value.startsWith('/') && !value.startsWith('//') && !/[\x00-\x1f\x7f]/.test(value); }
export function statusDetail(value) {
  if (!value || !Number.isInteger(value.statusCode) || value.statusCode < 100 || value.statusCode > 599
    || !path(value.finalPath) || !Array.isArray(value.redirects) || value.redirects.length > 20
    || !value.redirects.every(path) || !value.assets
    || !['requests', 'failed', 'httpErrors'].every(key => integer(value.assets[key], 1_000_000))) throw new Error('Invalid HTTP status metadata.');
  return { statusCode: value.statusCode, finalPath: value.finalPath, redirects: [...value.redirects],
    assets: { requests: value.assets.requests, failed: value.assets.failed, httpErrors: value.assets.httpErrors } };
}
export function comparisonDetail(kind, value, nested = false) {
  if (kind === 'behavior') return validateBehaviorComparison(value);
  if (kind === 'lighthouse') return validatePerformanceComparison(value);
  if (kind === 'content') return validateContentComparison(value);
  if (!value || typeof value.changed !== 'boolean') throw new Error('Invalid artifact comparison.');
  if (kind === 'status') return { changed: value.changed, a: statusDetail(value.a), b: statusDetail(value.b) };
  if (value.method !== 'prefix-suffix-replacement' || !Array.isArray(value.lines) || value.lines.length > 100
    || !['removedLines', 'addedLines', 'displayedLines', 'omittedLines'].every(key => integer(value[key], 4 * 1024 * 1024))
    || value.displayedLines !== value.lines.length
    || value.omittedLines + value.lines.length !== value.removedLines + value.addedLines) throw new Error('Invalid HTML comparison.');
  const lines = value.lines.map(line => {
    if (!line || !['removed', 'added'].includes(line.kind) || !integer(line.line, 4 * 1024 * 1024) || line.line < 1
      || typeof line.text !== 'string' || line.text.length > 2000 || typeof line.truncated !== 'boolean') throw new Error('Invalid HTML comparison line.');
    return { kind: line.kind, line: line.line, text: line.text, truncated: line.truncated };
  });
  const audit = {};
  if (!nested && value.rawWindow !== undefined) {
    audit.rawWindow = comparisonDetail('html', value.rawWindow, true);
    if (typeof value.rawChanged !== 'boolean' || !value.normalization || !isHash(value.normalization.policyHash)
      || !isHash(value.normalization.rawA) || !isHash(value.normalization.rawB)
      || !Array.isArray(value.normalization.fired) || value.normalization.fired.length > 50
      || !Array.isArray(value.normalization.scoped) || value.normalization.scoped.length > 50
      || !Array.isArray(value.normalization.diagnostics) || value.normalization.diagnostics.length > 51) throw new Error('Invalid normalization audit.');
    const id = value => typeof value === 'string' && value.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(value);
    const fired = value.normalization.fired.map(rule => {
      if (!id(rule.id) || !integer(rule.occurrences, 20) || rule.occurrences < 1) throw new Error('Invalid fired rule.');
      return { id: rule.id, occurrences: rule.occurrences };
    });
    if (!value.normalization.scoped.every(id)) throw new Error('Invalid scoped rules.');
    const diagnostics = value.normalization.diagnostics.map(diagnostic => {
      if (!id(diagnostic.id) || typeof diagnostic.reason !== 'string' || diagnostic.reason.length > 300) throw new Error('Invalid rule diagnostic.');
      return { id: diagnostic.id, reason: diagnostic.reason };
    });
    audit.rawChanged = value.rawChanged;
    audit.normalization = { policyHash: value.normalization.policyHash, rawA: value.normalization.rawA,
      rawB: value.normalization.rawB, fired, scoped: [...value.normalization.scoped], diagnostics };
  }
  return { ...audit, changed: value.changed, method: value.method, removedLines: value.removedLines,
    addedLines: value.addedLines, displayedLines: lines.length, omittedLines: value.omittedLines, lines };
}
