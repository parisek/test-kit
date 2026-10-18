// Pure. No DOM, no file system (R4.4).
export const LAYERS = Object.freeze(['package', 'project', 'component', 'page']);
export const BASES = Object.freeze(['absolute', 'relative']);
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const text = (value, max = 200) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
// Reads a caller list once and returns a validated copy, or null. Callers store only the copy.
const copyList = (value, max = 50) => {
  if (!Array.isArray(value)) return null;
  const length = value.length;
  if (length === 0 || length > max) return null;
  const out = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    const item = value[index];
    if (!text(item, 100)) return null;
    out.push(item);
  }
  return out;
};

// Copies a list by index with one read of each field. A hole is an error, never a skipped entry.
export function dense(list, name, max = 1000) {
  if (!Array.isArray(list)) throw new Error(`${name} must be a list.`);
  const length = list.length;
  if (length > max) throw new Error(`${name} is too long.`);
  const out = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(list, index)) throw new Error(`${name} has a hole at index ${index}.`);
    out.push(list[index]);
  }
  return out;
}

export function validateCheck(check) {
  if (!check || typeof check !== 'object') throw new Error('A check must be an object.');
  const { id, title, basis, applies, check: run } = check; // one read of each field
  if (typeof id !== 'string' || !ID.test(id) || id.length > 64) throw new Error('A check needs a lowercase kebab-case id.');
  if (!text(title)) throw new Error(`Check ${id} needs a title.`);
  if (!BASES.includes(basis)) throw new Error(`Check ${id} needs basis absolute or relative.`);
  if (!applies || typeof applies !== 'object') throw new Error(`Check ${id} needs applies.artifacts.`);
  const { artifacts: rawArtifacts, components: rawComponents } = applies;
  const artifacts = copyList(rawArtifacts);
  if (!artifacts) throw new Error(`Check ${id} needs applies.artifacts.`);
  const components = rawComponents === undefined ? null : copyList(rawComponents);
  if (rawComponents !== undefined && !components) throw new Error(`Check ${id} has invalid applies.components.`);
  if (typeof run !== 'function') throw new Error(`Check ${id} needs a check function.`);
  return Object.freeze({
    id, title, basis, check: run,
    applies: Object.freeze({ artifacts: Object.freeze(artifacts), ...(components ? { components: Object.freeze(components) } : {}) }),
  });
}

export function definePack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('A pack must be an object.');
  const { id, title, owner, checks: rawChecks } = pack; // one read of each field
  if (typeof id !== 'string' || !ID.test(id) || id.length > 64) throw new Error('A pack needs a lowercase kebab-case id.');
  if (!text(title)) throw new Error(`Pack ${id} needs a title.`);
  if (!text(owner)) throw new Error(`Pack ${id} needs a named owner.`);
  const listed = dense(rawChecks, `Pack ${id} checks`, 100);
  if (listed.length === 0) throw new Error(`Pack ${id} needs 1 to 100 checks.`);
  const checks = listed.map(validateCheck);
  if (new Set(checks.map(item => item.id)).size !== checks.length) throw new Error(`Pack ${id} has a duplicate check id.`);
  return Object.freeze({ id, title, owner, checks: Object.freeze(checks) });
}

export { text as isText, copyList };
