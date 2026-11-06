import { builtinChecks } from '../checks/index.js';
import { validateContractSelection } from '../behavior/contracts.js';
import { normalizeRules, normalizeKnown } from '../rules/model.js';
import { BUILTIN_PACK_IDS } from '../packs/ids.js';
import { DEFAULT_MOUNT, MAX_COMPONENTS, validMount } from '../styleguide/index.js';
import { ALLOW_ORIGIN_TYPES } from '../capture/helpers.js';
import { designPathProblem, designRootProblem } from '../design/paths.js';
import { DEFAULT_RUNS_ROOT } from './store.js';
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
function dense(values, name) {
  for (let index = 0; index < values.length; index += 1) if (!Object.hasOwn(values, index)) fail(`${name} has a hole at index ${index}`);
  return values;
}
function unique(values, name) {
  if (new Set(values).size !== values.length) fail(`${name} IDs must be unique`);
}
function origin(value, name, remote = false) {
  text(value, name, 300);
  let url;
  try { url = new URL(value); } catch { fail(`${name} must be a URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(`${name} must be an HTTP origin without credentials or a path`);
  const host = url.hostname;
  if (!remote && !(host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || host.endsWith('.ddev.site'))) fail(`${name} must be local`);
  return url.origin;
}
// R3.4: a header value. Printable ASCII only, so no value can add a header line.
function userAgent(value, name) {
  if (typeof value !== 'string' || !/^[\x21-\x7e](?:[\x20-\x7e]{0,510}[\x21-\x7e])?$/.test(value)) fail(`${name} must be 1..512 printable ASCII characters without leading or trailing space`);
  return value;
}
// R3.9: extra origins a side (local or remote) may read. Each entry names one HTTPS origin and the
// resource types it may load. GET and HEAD only is a rule of the request policy, not a key.
const ALLOW_ORIGINS_MAX = 20;
function allowOrigins(value, name) {
  const items = dense(list(value, name, ALLOW_ORIGINS_MAX, 1), name);
  const result = items.map((entry, index) => {
    const label = `${name}[${index}]`;
    object(entry, label, ['origin', 'types']);
    text(entry.origin, `${label}.origin`, 300);
    if (entry.origin.includes('*')) fail(`${label}.origin must not hold a wildcard`);
    let url;
    try { url = new URL(entry.origin); } catch { fail(`${label}.origin must be a URL`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(`${label}.origin must be an HTTPS origin without credentials, path, query or fragment`);
    const types = dense(list(entry.types, `${label}.types`, ALLOW_ORIGIN_TYPES.length, 1), `${label}.types`);
    for (const type of types) if (typeof type !== 'string' || !ALLOW_ORIGIN_TYPES.includes(type)) fail(`${label}.types must be from: ${ALLOW_ORIGIN_TYPES.join(', ')}`);
    unique(types, `${label}.types`);
    return { origin: url.origin, types: [...types] };
  });
  unique(result.map(entry => entry.origin), `${name} origin`);
  return result;
}
function targetPath(value, name) {
  text(value, name, 2000);
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) fail(`${name} must be origin-relative`);
  let url;
  try { url = new URL(value, 'http://localhost'); } catch { fail(`${name} must be origin-relative`); }
  if (url.origin !== 'http://localhost') fail(`${name} must stay on its origin`);
  return value;
}
export function normalizeSettlement(value, name = 'settle', partial = false) {
  const source = object(value, name, ['waitMs', 'selectors', 'disableMotion', 'masks', 'reveal', 'lazyImages']);
  const result = {};
  for (const key of ['waitMs', 'selectors', 'disableMotion', 'masks']) {
    if (partial && !Object.hasOwn(source, key)) continue;
    if (key === 'waitMs') result[key] = number(partial ? source[key] : source[key] ?? 0, `${name}.${key}`, 0, 10000);
    else if (key === 'disableMotion') result[key] = bool(partial ? source[key] : source[key] ?? true, `${name}.${key}`);
    else result[key] = list(partial ? source[key] : source[key] ?? [], `${name}.${key}`, 50).map(value => text(value, `${name}.${key}`, 1000));
  }
  if (Object.hasOwn(source, 'reveal')) result.reveal = list(source.reveal, `${name}.reveal`, 20).map(step => {
    object(step, `${name}.reveal step`, ['action', 'selector']);
    if (!['click', 'hover', 'focus'].includes(step.action)) fail(`${name}.reveal action must be click, hover or focus`);
    return { action: step.action, selector: text(step.selector, `${name}.reveal selector`, 2048) };
  });
  if (Object.hasOwn(source, 'lazyImages')) result.lazyImages = bool(source.lazyImages, `${name}.lazyImages`);
  return result;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// R5.5: a side of kind `design` holds supplied images. It has no origin and opens no browser or network.
// Only the provider `files` exists. `root` is a plain relative directory, resolved from the configuration directory.
function normalizeDesignSide(side, name) {
  object(side, name, ['kind', 'provider', 'root']);
  if (side.kind !== 'design') fail(`${name}.kind must be "design"`);
  if (side.provider !== 'files') fail(`${name}.provider must be "files"`);
  const problem = designRootProblem(side.root);
  if (problem) fail(`${name}.root ${problem}`);
  return { kind: 'design', provider: 'files', root: side.root };
}

// R5.5: the map from viewport ID to a PNG path under the `root` of a design side. Viewport IDs are checked later.
function normalizeDesignMap(value) {
  object(value, 'target.design');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 20) fail('target.design must have 1..20 entries');
  return Object.fromEntries(entries.map(([viewportId, path]) => {
    id(viewportId, 'target.design viewport ID');
    const problem = designPathProblem(path);
    if (problem) fail(`target.design.${viewportId} ${problem}`);
    return [viewportId, path];
  }));
}

// R13.3: `targetSource` reads component targets from the styleguide catalogue of one side.
// Validation is pure: it reads no network and imports no styleguide code (R4.4, R13.4).
function normalizeTargetSource(value, sides) {
  object(value, 'targetSource', ['source', 'side', 'mount', 'include', 'variants', 'pages']);
  if (value.source !== 'styleguide') fail('targetSource.source must be "styleguide"');
  const side = id(value.side, 'targetSource.side');
  if (!Object.hasOwn(sides, side)) fail(`targetSource.side has unknown side ${side}`);
  if (sides[side].remote === true || sides[side].kind === 'design') fail('targetSource.side must be a local side');
  const mount = value.mount === undefined ? DEFAULT_MOUNT : value.mount;
  if (!validMount(mount)) fail('targetSource.mount must be an origin-relative path');
  const result = { source: 'styleguide', side, mount };
  if (value.include !== undefined) {
    const include = dense(list(value.include, 'targetSource.include', MAX_COMPONENTS, 1), 'targetSource.include').map(item => id(item, 'targetSource.include ID'));
    unique(include, 'targetSource.include');
    result.include = include;
  }
  // R13.52: the variants of an entry and the page previews are opt-in. Absent means false.
  for (const key of ['variants', 'pages']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') fail(`targetSource.${key} must be a boolean`);
    if (value[key]) result[key] = true;
  }
  return result;
}

export const DEFAULT_ARTIFACTS = Object.freeze(['screenshot']);

export function normalizeConfig(input) {
  object(input, 'config', ['schemaVersion', 'sides', 'targets', 'viewports', 'artifacts', 'checks', 'runsRoot', 'screenshot', 'rules', 'known_diffs', 'content', 'behavior', 'packs', 'targetSource']);
  if (input.schemaVersion !== 1) fail('schemaVersion must be 1');
  object(input.sides, 'sides');
  const sideEntries = Object.entries(input.sides);
  if (!sideEntries.length || sideEntries.length > 20) fail('sides must have 1..20 entries');
  const sides = Object.fromEntries(sideEntries.map(([sideId, side]) => {
    id(sideId, 'side ID');
    // R5.5: a side with a `kind` key is a design side. A side without it is a browser side, as before.
    if (side && typeof side === 'object' && !Array.isArray(side) && Object.hasOwn(side, 'kind')) return [sideId, normalizeDesignSide(side, `sides.${sideId}`)];
    object(side, `sides.${sideId}`, ['origin', 'settle', 'remote', 'production', 'userAgent', 'challenge', 'allowOrigins', 'thirdParty']);
    if (Object.hasOwn(side, 'remote') && typeof side.remote !== 'boolean') fail(`sides.${sideId}.remote must be a boolean`);
    // R6.5: the flag, not the side id, marks a production side.
    if (Object.hasOwn(side, 'production') && typeof side.production !== 'boolean') fail(`sides.${sideId}.production must be a boolean`);
    const remote = side.remote === true;
    if (Object.hasOwn(side, 'userAgent') && !remote) fail(`sides.${sideId}.userAgent requires remote true`);
    // R3.5: one known CDN challenge. A local side never meets one.
    if (Object.hasOwn(side, 'challenge') && !remote) fail(`sides.${sideId}.challenge requires remote true`);
    if (Object.hasOwn(side, 'challenge') && side.challenge !== 'cloudflare') fail(`sides.${sideId}.challenge must be "cloudflare"`);
    // R3.10: the mode for a frame or subresource of another origin. Both sides accept it.
    if (Object.hasOwn(side, 'thirdParty') && !['block', 'drop'].includes(side.thirdParty)) fail(`sides.${sideId}.thirdParty must be "block" or "drop"`);
    return [sideId, { origin: origin(side.origin, `sides.${sideId}.origin`, remote),
      ...(remote ? { remote: true } : {}),
      ...(Object.hasOwn(side, 'userAgent') ? { userAgent: userAgent(side.userAgent, `sides.${sideId}.userAgent`) } : {}),
      ...(Object.hasOwn(side, 'challenge') ? { challenge: side.challenge } : {}),
      ...(Object.hasOwn(side, 'allowOrigins') ? { allowOrigins: allowOrigins(side.allowOrigins, `sides.${sideId}.allowOrigins`) } : {}),
      ...(Object.hasOwn(side, 'thirdParty') ? { thirdParty: side.thirdParty } : {}),
      ...(side.production === true ? { production: true } : {}),
      settle: normalizeSettlement(side.settle ?? {}, `sides.${sideId}.settle`) }];
  }));
  // R13.3: components from the styleguide are an opt-in target source. It replaces the list.
  const targetSource = Object.hasOwn(input, 'targetSource') ? normalizeTargetSource(input.targetSource, sides) : undefined;
  if (targetSource && input.targets !== undefined && !(Array.isArray(input.targets) && input.targets.length === 0)) fail('targets must be absent or empty when targetSource is set');
  const targets = list(targetSource ? [] : input.targets, 'targets', 1000, targetSource ? 0 : 1).map(target => {
    object(target, 'target', ['id', 'kind', 'title', 'path', 'paths', 'selector', 'box', 'settle', 'settleBySide', 'design']);
    const targetId = id(target.id, 'target ID');
    if (!['page', 'component'].includes(target.kind)) fail('target.kind must be page or component');
    const result = { id: targetId, kind: target.kind, title: text(target.title ?? targetId, 'target.title') };
    if (Object.hasOwn(target, 'settle')) result.settle = normalizeSettlement(target.settle, 'target.settle', true);
    if (Object.hasOwn(target, 'settleBySide')) {
      result.settleBySide = Object.fromEntries(Object.entries(object(target.settleBySide, 'target.settleBySide')).map(([sideId, recipe]) => {
        if (!Object.hasOwn(sides, sideId)) fail(`target.settleBySide has unknown side ${sideId}`);
        return [sideId, normalizeSettlement(recipe, `target.settleBySide.${sideId}`, true)];
      }));
    }
    if (target.selector !== undefined) {
      result.selector = Array.isArray(target.selector)
        ? list(target.selector, 'target.selector', 50, 1).map(value => text(value, 'target.selector', 2048))
        : text(target.selector, 'target.selector', 2048);
      if (Array.isArray(result.selector)) unique(result.selector, 'target.selector');
    }
    if (target.box !== undefined) {
      if (!target.selector || !['border', 'content'].includes(target.box)) fail('target.box requires a selector and must be border or content');
      result.box = target.box;
    }
    if (target.path !== undefined) result.path = targetPath(target.path, 'target.path');
    if (target.paths !== undefined) {
      object(target.paths, 'target.paths');
      result.paths = Object.fromEntries(Object.entries(target.paths).map(([sideId, path]) => {
        if (!Object.hasOwn(sides, sideId)) fail(`target.paths has unknown side ${sideId}`);
        return [sideId, targetPath(path, 'target.paths')];
      }));
    }
    // A design side holds images, not pages, so it needs no path.
    for (const [sideId, side] of Object.entries(sides)) if (side.kind !== 'design' && !result.path && !(result.paths && Object.hasOwn(result.paths, sideId))) fail(`target ${targetId} has no path for ${sideId}`);
    if (target.design !== undefined) {
      if (!Object.values(sides).some(side => side.kind === 'design')) fail('target.design needs a side of kind "design"');
      result.design = normalizeDesignMap(target.design);
    }
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
  for (const target of targets) for (const viewportId of Object.keys(target.design ?? {})) if (!viewports.some(viewport => viewport.id === viewportId)) fail(`target ${target.id} design has unknown viewport ${viewportId}`);
  const artifacts = list(input.artifacts ?? DEFAULT_ARTIFACTS, 'artifacts', 5, 1);
  if (artifacts.some(kind => !['screenshot', 'html', 'status', 'content', 'behavior'].includes(kind))) fail('unsupported artifact');
  unique(artifacts, 'artifact');
  const checks = list(input.checks ?? [], 'checks', 6).map(value => id(value, 'check ID'));
  unique(checks, 'check');
  if (checks.some(check => !Object.hasOwn(builtinChecks, check))) fail('unknown content check');
  if (checks.length && !artifacts.includes('content')) fail('checks require the content artifact');
  const packs = (input.packs === undefined ? [] : dense(list(input.packs, 'packs', BUILTIN_PACK_IDS.length), 'packs')).map(value => id(value, 'pack ID'));
  unique(packs, 'pack');
  if (packs.some(pack => !BUILTIN_PACK_IDS.includes(pack))) fail(`unknown pack (known: ${BUILTIN_PACK_IDS.join(', ')})`);
  const contentInput = object(input.content ?? {}, 'content', ['expectedLanguage']);
  const content = {};
  if (contentInput.expectedLanguage !== undefined) content.expectedLanguage = text(contentInput.expectedLanguage, 'content.expectedLanguage', 100);
  const behaviorInput = object(input.behavior ?? {}, 'behavior', ['source', 'lockfile', 'projects', 'timeoutMs', 'maxInstances', 'trace', 'emulate', 'enabled']);
  const behavior = {};
  if (behaviorInput.enabled !== undefined) behavior.enabled = validateContractSelection(behaviorInput.enabled);
  for (const key of ['source', 'lockfile']) if (behaviorInput[key] !== undefined) {
    const value = text(behaviorInput[key], `behavior.${key}`, 500);
    if (!/^[a-zA-Z0-9_-]+(?:[a-zA-Z0-9._/-]*[a-zA-Z0-9_-])?$/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) fail('behavior source paths must be plain relative paths');
    behavior[key] = value;
  }
  if (artifacts.includes('behavior') && !behavior.source) fail('behavior requires a trusted source directory');
  behavior.lockfile ??= 'package-lock.json';
  behavior.projects = {};
  for (const [key, value] of Object.entries(object(behaviorInput.projects ?? {}, 'behavior.projects'))) {
    if (!viewports.some(viewport => viewport.id === key)) fail('behavior project has unknown viewport');
    behavior.projects[key] = id(value, 'behavior project');
  }
  behavior.timeoutMs = number(behaviorInput.timeoutMs ?? 10000, 'behavior.timeoutMs', 1, 120000);
  behavior.maxInstances = number(behaviorInput.maxInstances ?? 20, 'behavior.maxInstances', 1, 100);
  behavior.trace = bool(behaviorInput.trace ?? false, 'behavior.trace');
  behavior.emulate = { ...object(behaviorInput.emulate ?? {}, 'behavior.emulate', ['reducedMotion', 'colorScheme']) };
  if (behavior.emulate.reducedMotion !== undefined && !['reduce', 'no-preference'].includes(behavior.emulate.reducedMotion)) fail('unsupported behavior reducedMotion');
  if (behavior.emulate.colorScheme !== undefined && !['light', 'dark', 'no-preference'].includes(behavior.emulate.colorScheme)) fail('unsupported behavior colorScheme');
  const runsRoot = text(input.runsRoot ?? DEFAULT_RUNS_ROOT, 'runsRoot', 500);
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(runsRoot) || runsRoot.split('/').some(segment => segment === '.' || segment === '..')) fail('runsRoot must be a plain relative path');
  const shot = object(input.screenshot ?? {}, 'screenshot', ['timeoutMs', 'fullPage']);
  const screenshot = { timeoutMs: number(shot.timeoutMs ?? 30000, 'timeoutMs', 1, 120000), fullPage: bool(shot.fullPage ?? true, 'fullPage') };
  return freeze({ schemaVersion: 1, sides, targets, ...(targetSource ? { targetSource } : {}), viewports, artifacts: [...artifacts], checks, packs, content, behavior, runsRoot, screenshot, rules: normalizeRules(input.rules), known_diffs: normalizeKnown(input.known_diffs) });
}
