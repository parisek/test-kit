// Pure. Builds the plan of checks and overrides. It runs nothing (R4.4, R5.1).
import { LAYERS, dense, definePack, validateCheck, isText, copyList } from './define.js';
const SCOPE_KEYS = ['targets', 'artifacts', 'kinds'];
const KINDS = ['single-run']; // R8.5 defines this value for the kinds axis
const resolved = new WeakSet();
export const isResolvedPlan = plan => resolved.has(plan);
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const rank = layer => LAYERS.indexOf(layer);

function validateOverride(item, byId) {
  if (!item || typeof item !== 'object') throw new Error('An override must be an object.');
  const { checkId, layer, reason, owner, scope: rawScope } = item; // one read of each field
  const entry = byId.get(checkId);
  if (!entry) throw new Error('An override names an unknown check.');
  if (!LAYERS.includes(layer) || rank(layer) <= rank(entry.layer)) throw new Error(`An override of ${checkId} must come from a layer narrower than ${entry.layer}.`);
  if (!isText(reason, 500) || !isText(owner)) throw new Error(`An override of ${checkId} needs a reason and an owner.`);
  const scope = rawScope ?? {};
  const invalid = () => new Error(`An override of ${checkId} has an invalid scope.`);
  // Own keys only. A prototype, a symbol, a hidden key or an unknown key is invalid, so a bad scope never becomes global.
  if (!plain(scope)) throw invalid();
  const stored = {};
  for (const key of Reflect.ownKeys(scope)) {
    if (!SCOPE_KEYS.includes(key)) throw invalid();
    const copy = copyList(scope[key]); // one read of the value, then one copy; validate and store that copy
    if (!copy || (key === 'kinds' && !copy.every(kind => KINDS.includes(kind)))) throw invalid();
    stored[key] = Object.freeze(copy);
  }
  return Object.freeze({ checkId, layer, reason, owner, scope: Object.freeze(stored) });
}

export function resolveChecks({ available = [], packs = [], custom = [], overrides = [] } = {}) {
  available = dense(available, 'available'); packs = dense(packs, 'packs'); custom = dense(custom, 'custom'); overrides = dense(overrides, 'overrides');
  const known = new Map();
  for (const pack of available.map(definePack)) {
    if (known.has(pack.id)) throw new Error(`Duplicate pack ${pack.id}.`);
    known.set(pack.id, pack);
  }
  if (new Set(packs).size !== packs.length) throw new Error('Duplicate pack in selection.');
  const entries = [];
  for (const id of packs) {
    if (!known.has(id)) throw new Error(`Unknown pack ${String(id).slice(0, 64)}.`);
    for (const check of known.get(id).checks) entries.push({ check, layer: 'package', packId: id });
  }
  for (const item of custom) {
    if (!item || typeof item !== 'object') throw new Error('A custom check needs layer project, component or page.');
    const { layer, check: rawCheck } = item; // one read of each field
    if (!['project', 'component', 'page'].includes(layer)) throw new Error('A custom check needs layer project, component or page.');
    const check = validateCheck(rawCheck);
    if ((layer === 'component') !== Boolean(check.applies.components)) throw new Error(`Check ${check.id}: only a component check declares applies.components, and it must.`);
    entries.push({ check, layer, packId: null });
  }
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.check.id)) throw new Error(`Duplicate check id ${entry.check.id}.`);
    byId.set(entry.check.id, Object.freeze(entry));
  }
  const records = overrides.map(item => validateOverride(item, byId));
  const plan = Object.freeze({ checks: Object.freeze([...byId.values()]), overrides: Object.freeze(records) });
  resolved.add(plan);
  return plan;
}
