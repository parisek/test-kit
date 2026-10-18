// Pure. No DOM, no file system (R4.4).
export const LAYERS = Object.freeze(['package', 'project', 'component', 'page']);
export const BASES = Object.freeze(['absolute', 'relative']);
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const text = (value, max = 200) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const list = (value, max = 50) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index) || !text(value[index], 100)) return false;
  return true;
};

// Copies a list by index. A hole is an error, never a skipped entry.
export function dense(list, name) {
  if (!Array.isArray(list)) throw new Error(`${name} must be a list.`);
  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    if (!Object.hasOwn(list, index)) throw new Error(`${name} has a hole at index ${index}.`);
    out.push(list[index]);
  }
  return out;
}

export function validateCheck(check) {
  if (!check || typeof check !== 'object') throw new Error('A check must be an object.');
  const { id, title, basis, applies, check: run } = check;
  if (typeof id !== 'string' || !ID.test(id) || id.length > 64) throw new Error('A check needs a lowercase kebab-case id.');
  if (!text(title)) throw new Error(`Check ${id} needs a title.`);
  if (!BASES.includes(basis)) throw new Error(`Check ${id} needs basis absolute or relative.`);
  if (!applies || typeof applies !== 'object' || !list(applies.artifacts)) throw new Error(`Check ${id} needs applies.artifacts.`);
  if (applies.components !== undefined && !list(applies.components)) throw new Error(`Check ${id} has invalid applies.components.`);
  if (typeof run !== 'function') throw new Error(`Check ${id} needs a check function.`);
  return Object.freeze({
    id, title, basis, check: run,
    applies: Object.freeze({ artifacts: Object.freeze([...applies.artifacts]), ...(applies.components ? { components: Object.freeze([...applies.components]) } : {}) }),
  });
}

export function definePack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('A pack must be an object.');
  if (typeof pack.id !== 'string' || !ID.test(pack.id) || pack.id.length > 64) throw new Error('A pack needs a lowercase kebab-case id.');
  if (!text(pack.title)) throw new Error(`Pack ${pack.id} needs a title.`);
  if (!text(pack.owner)) throw new Error(`Pack ${pack.id} needs a named owner.`);
  if (!Array.isArray(pack.checks) || pack.checks.length === 0 || pack.checks.length > 100) throw new Error(`Pack ${pack.id} needs 1 to 100 checks.`);
  const checks = dense(pack.checks, `Pack ${pack.id} checks`).map(validateCheck);
  if (new Set(checks.map(item => item.id)).size !== checks.length) throw new Error(`Pack ${pack.id} has a duplicate check id.`);
  return Object.freeze({ id: pack.id, title: pack.title, owner: pack.owner, checks: Object.freeze(checks) });
}

export { text as isText, list as isList };
