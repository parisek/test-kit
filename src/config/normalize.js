import { normalizeRules, normalizeKnown } from '../rules/model.js';
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function fail(message) { throw new Error(`Invalid configuration: ${message}`); }
function object(value, name, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name}.${key} is unsupported`);
  return value;
}
function id(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${name} must be a safe ID`);
  return value;
}
function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`${name} must be bounded text`);
  return value;
}
function number(value, name, min, max, integer = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${name} must be ${min}..${max}`);
  return value;
}
function bool(value, name) {
  if (typeof value !== 'boolean') fail(`${name} must be boolean`);
  return value;
}
function list(value, name, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${name} must have ${min}..${max} items`);
  return value;
}
function unique(values, name) {
  if (new Set(values).size !== values.length) fail(`${name} IDs must be unique`);
}
function origin(value, name) {
  text(value, name, 300);
  let url;
  try { url = new URL(value); } catch { fail(`${name} must be a URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(`${name} must be an HTTP origin without credentials or a path`);
  const host = url.hostname;
  if (!(host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || host.endsWith('.ddev.site'))) fail(`${name} must be local`);
  return url.origin;
}
function targetPath(value, name) {
  text(value, name, 2000);
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) fail(`${name} must be origin-relative`);
  let url;
  try { url = new URL(value, 'http://localhost'); } catch { fail(`${name} must be origin-relative`); }
  if (url.origin !== 'http://localhost') fail(`${name} must stay on its origin`);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function normalizeConfig(input) {
  object(input, 'config', ['schemaVersion', 'sides', 'targets', 'viewports', 'artifacts', 'checks', 'runsRoot', 'screenshot', 'rules', 'known_diffs']);
  if (input.schemaVersion !== 1) fail('schemaVersion must be 1');
  object(input.sides, 'sides');
  const sideEntries = Object.entries(input.sides);
  if (!sideEntries.length || sideEntries.length > 20) fail('sides must have 1..20 entries');
  const sides = Object.fromEntries(sideEntries.map(([sideId, side]) => {
    id(sideId, 'side ID');
    object(side, `sides.${sideId}`, ['origin', 'settle']);
    const settle = object(side.settle ?? {}, 'settle', ['waitMs', 'selectors', 'disableMotion', 'masks']);
    const selectors = key => list(settle[key] ?? [], key, 50).map(value => text(value, key, 1000));
    return [sideId, { origin: origin(side.origin, `sides.${sideId}.origin`), settle: {
      waitMs: number(settle.waitMs ?? 0, 'waitMs', 0, 10000),
      selectors: selectors('selectors'), disableMotion: bool(settle.disableMotion ?? true, 'disableMotion'), masks: selectors('masks'),
    } }];
  }));
  const targets = list(input.targets, 'targets', 1000, 1).map(target => {
    object(target, 'target', ['id', 'kind', 'title', 'path', 'paths', 'selector']);
    const targetId = id(target.id, 'target ID');
    if (!['page', 'component'].includes(target.kind)) fail('target.kind must be page or component');
    const result = { id: targetId, kind: target.kind, title: text(target.title ?? targetId, 'target.title') };
    if (target.selector !== undefined) result.selector = text(target.selector, 'target.selector', 2048);
    if (target.path !== undefined) result.path = targetPath(target.path, 'target.path');
    if (target.paths !== undefined) {
      object(target.paths, 'target.paths');
      result.paths = Object.fromEntries(Object.entries(target.paths).map(([sideId, path]) => {
        if (!Object.hasOwn(sides, sideId)) fail(`target.paths has unknown side ${sideId}`);
        return [sideId, targetPath(path, 'target.paths')];
      }));
    }
    for (const sideId of Object.keys(sides)) if (!result.path && !(result.paths && Object.hasOwn(result.paths, sideId))) fail(`target ${targetId} has no path for ${sideId}`);
    return result;
  });
  unique(targets.map(target => target.id), 'target');
  const viewports = list(input.viewports, 'viewports', 20, 1).map(viewport => {
    object(viewport, 'viewport', ['id', 'width', 'height', 'deviceScaleFactor']);
    const result = { id: id(viewport.id, 'viewport ID'), width: number(viewport.width, 'width', 1, 4096), height: number(viewport.height, 'height', 1, 4096), deviceScaleFactor: number(viewport.deviceScaleFactor ?? 1, 'deviceScaleFactor', 0.5, 3, false) };
    if (result.width * result.height * result.deviceScaleFactor ** 2 > 32_000_000) fail('viewport exceeds 32 million pixels');
    return result;
  });
  unique(viewports.map(viewport => viewport.id), 'viewport');
  const artifacts = list(input.artifacts ?? ['screenshot'], 'artifacts', 3, 1);
  if (artifacts.some(kind => !['screenshot', 'html', 'status'].includes(kind))) fail('unsupported artifact');
  unique(artifacts, 'artifact');
  list(input.checks ?? [], 'checks', 0);
  const runsRoot = text(input.runsRoot ?? 'tests/visual/runs', 'runsRoot', 500);
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(runsRoot)) fail('runsRoot must be a plain relative path');
  const shot = object(input.screenshot ?? {}, 'screenshot', ['timeoutMs', 'fullPage']);
  const screenshot = { timeoutMs: number(shot.timeoutMs ?? 30000, 'timeoutMs', 1, 120000), fullPage: bool(shot.fullPage ?? true, 'fullPage') };
  return freeze({ schemaVersion: 1, sides, targets, viewports, artifacts: [...artifacts], checks: [], runsRoot, screenshot, rules: normalizeRules(input.rules), known_diffs: normalizeKnown(input.known_diffs) });
}
