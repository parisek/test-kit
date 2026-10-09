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
