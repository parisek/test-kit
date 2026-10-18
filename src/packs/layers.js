// Pure. Builds the plan of checks and overrides. It runs nothing (R4.4, R5.1).
import { LAYERS, dense, definePack, validateCheck, isText, isList } from './define.js';
const SCOPE_KEYS = ['targets', 'artifacts', 'kinds'];
const KINDS = ['single-run']; // R8.5 defines this value for the kinds axis
const resolved = new WeakSet();
export const isResolvedPlan = plan => resolved.has(plan);
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const rank = layer => LAYERS.indexOf(layer);

function validateOverride(item, byId) {
  if (!item || typeof item !== 'object') throw new Error('An override must be an object.');
  const entry = byId.get(item.checkId);
  if (!entry) throw new Error('An override names an unknown check.');
  if (!LAYERS.includes(item.layer) || rank(item.layer) <= rank(entry.layer)) throw new Error(`An override of ${item.checkId} must come from a layer narrower than ${entry.layer}.`);
  if (!isText(item.reason, 500) || !isText(item.owner)) throw new Error(`An override of ${item.checkId} needs a reason and an owner.`);
  const scope = item.scope ?? {};
  // Own keys only. A prototype, a symbol, a hidden key or an unknown key is invalid, so a bad scope never becomes global.
  if (!plain(scope) || Reflect.ownKeys(scope).some(key => !SCOPE_KEYS.includes(key)) || SCOPE_KEYS.some(key => Object.hasOwn(scope, key) && !isList(scope[key])) || (Object.hasOwn(scope, 'kinds') && !scope.kinds.every(kind => KINDS.includes(kind)))) throw new Error(`An override of ${item.checkId} has an invalid scope.`);
  return Object.freeze({ checkId: item.checkId, layer: item.layer, reason: item.reason, owner: item.owner, scope: Object.freeze(Object.fromEntries(SCOPE_KEYS.filter(key => Object.hasOwn(scope, key)).map(key => [key, scope[key]]).map(([key, value]) => [key, Object.freeze([...value])]))) });
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
    if (!item || typeof item !== 'object' || !['project', 'component', 'page'].includes(item.layer)) throw new Error('A custom check needs layer project, component or page.');
    const check = validateCheck(item.check);
    if ((item.layer === 'component') !== Boolean(check.applies.components)) throw new Error(`Check ${check.id}: only a component check declares applies.components, and it must.`);
    entries.push({ check, layer: item.layer, packId: null });
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
