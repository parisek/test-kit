// Pure validation of the layout declarations (R6.14, R4.4): `targets[].layout` and the top-level `layout` key.
// A function returns the normalised value or throws. Callers add their own message prefix.

export const MAX_PARTS = 50;
export const MAX_REPEAT = 50;
export const MAX_ALIASES = 500;
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN = /^--[A-Za-z0-9_-]{1,126}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

// `targets[].layout`: `{ parts: [ { id, selector, repeat? } ] }`, 1 to 50 parts with unique IDs.
export function normalizeLayoutParts(input) {
  if (!plain(input) || Object.keys(input).some(key => key !== 'parts')) throw new Error('target.layout must be an object with the one key parts');
  const parts = input.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) throw new Error(`target.layout.parts must have 1..${MAX_PARTS} items`);
  const ids = new Set();
  const result = Array.from({ length: parts.length }, (_, index) => {
    const part = parts[index];
    if (!Object.hasOwn(parts, index) || !plain(part) || Object.keys(part).some(key => !['id', 'selector', 'repeat'].includes(key))) throw new Error('target.layout.parts holds an object with id, selector and optional repeat');
    if (typeof part.id !== 'string' || !PART_ID.test(part.id)) throw new Error('target.layout.parts id must be a safe ID');
    if (ids.has(part.id)) throw new Error('target.layout.parts IDs must be unique');
    ids.add(part.id);
    if (!bounded(part.selector, 2048)) throw new Error('target.layout.parts selector must be bounded text');
    if (part.repeat !== undefined && typeof part.repeat !== 'boolean') throw new Error('target.layout.parts repeat must be boolean');
    return { id: part.id, selector: part.selector, ...(part.repeat === true ? { repeat: true } : {}) };
  });
  return { parts: result };
}

// The top-level `layout` key: `{ aliases? }`. An alias maps a token of side A to a token of side B.
export function normalizeLayoutConfig(input) {
  if (!plain(input) || Object.keys(input).some(key => key !== 'aliases')) throw new Error('layout must be an object with the optional key aliases');
  if (input.aliases === undefined) return {};
  if (!plain(input.aliases)) throw new Error('layout.aliases must be an object');
  const entries = Object.entries(input.aliases);
  if (entries.length > MAX_ALIASES) throw new Error(`layout.aliases must have at most ${MAX_ALIASES} entries`);
  for (const [from, to] of entries) if (!TOKEN.test(from) || typeof to !== 'string' || !TOKEN.test(to)) throw new Error('layout.aliases maps a custom property name to a custom property name');
  return { aliases: Object.fromEntries(entries.sort(([x], [y]) => x < y ? -1 : 1)) };
}
