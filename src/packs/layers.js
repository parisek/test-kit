// Pure. Builds the plan of checks and overrides. It runs nothing (R4.4, R5.1).
import { LAYERS, definePack, validateCheck, isText, isList } from './define.js';
const SCOPE_KEYS = ['targets', 'artifacts', 'kinds'];
const rank = layer => LAYERS.indexOf(layer);

function validateOverride(item, byId) {
  if (!item || typeof item !== 'object') throw new Error('An override must be an object.');
  const entry = byId.get(item.checkId);
  if (!entry) throw new Error('An override names an unknown check.');
  if (!LAYERS.includes(item.layer) || rank(item.layer) <= rank(entry.layer)) throw new Error(`An override of ${item.checkId} must come from a layer narrower than ${entry.layer}.`);
  if (!isText(item.reason, 500) || !isText(item.owner)) throw new Error(`An override of ${item.checkId} needs a reason and an owner.`);
  const scope = item.scope ?? {};
  if (typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some(key => !SCOPE_KEYS.includes(key)) || Object.values(scope).some(value => !isList(value))) throw new Error(`An override of ${item.checkId} has an invalid scope.`);
  return Object.freeze({ checkId: item.checkId, layer: item.layer, reason: item.reason, owner: item.owner, scope: Object.freeze(Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, Object.freeze([...value])]))) });
}

export function resolveChecks({ available = [], packs = [], custom = [], overrides = [] } = {}) {
  if (![available, packs, custom, overrides].every(Array.isArray)) throw new Error('Invalid pack selection.');
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
  return Object.freeze({ checks: Object.freeze([...byId.values()]), overrides: Object.freeze(records) });
}
