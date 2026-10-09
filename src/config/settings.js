import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function settingsHash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

export function captureSettings(config, sideId) {
  if (!Object.hasOwn(config.sides, sideId)) throw new Error(`Unknown side: ${sideId}`);
  return { viewports: config.viewports, settle: config.sides[sideId].settle, screenshot: config.screenshot };
}

// Response artifacts do not depend on screenshot settlement or image settings.
export function responseSettings(config, kind) {
  return { mode: kind === 'html' ? 'response-body' : 'http-metadata', version: 1,
    viewports: config.viewports, maxBytes: 2 * 1024 * 1024 };
}

export function contentSettings(config, side) {
  const { masks, ...settle } = config.sides[side].settle;
  return { mode: 'settled-dom', extractorVersion: '1.0.0', viewports: config.viewports, settle, maxItems: 1000, maxText: 100000, maxBytes: 2 * 1024 * 1024 };
}

// Paths and titles can differ between sides. The screenshot scope cannot.
export function screenshotScope(target) {
  const selector = target?.selector ?? null;
  const box = target?.box ?? 'border';
  const valid = value => typeof value === 'string' && value.trim() && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
  if (selector !== null && !(Array.isArray(selector) ? selector.length > 0 && selector.length <= 50 && selector.every(valid) && new Set(selector).size === selector.length : valid(selector))) throw new Error('Invalid stored screenshot selector.');
  if (!['border', 'content'].includes(box) || (selector === null && target?.box !== undefined)) throw new Error('Invalid stored screenshot box.');
  return { selector, box };
}

export function scopeMatches(capture, scope) {
  const hash = settingsHash(scope);
  return capture.scopeHash === undefined
    ? !Array.isArray(scope.selector) && scope.box === 'border'
    : capture.scopeHash === hash;
}
