// Pure validation of the layout declarations (R6.14, R4.4): `targets[].layout` and the top-level `layout` key.
// A function returns the normalised value or throws. Callers add their own message prefix.

export const MAX_PARTS = 50;
export const MAX_REPEAT = 50;
export const MAX_ALIASES = 500;
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SIDE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export const MAX_SIDE_SELECTORS = 20;
const TOKEN = /^--[A-Za-z0-9_-]{1,126}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

// `targets[].layout`: `{ parts: [ { id, selector, selectorBySide?, repeat? } ] }`, 1 to 50 parts with unique IDs.
// `selectorBySide` maps a side ID to the selector of the part on that side (#350, part C): a design canvas and a site
// have other markup. `sides`, when given, lists the side IDs of the configuration, and an unknown side fails.
// A stored declaration is read without it, so only the form of each key is checked there.
export function normalizeLayoutParts(input, sides = null) {
  if (!plain(input) || Object.keys(input).some(key => key !== 'parts')) throw new Error('target.layout must be an object with the one key parts');
  const parts = input.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) throw new Error(`target.layout.parts must have 1..${MAX_PARTS} items`);
  const ids = new Set();
  const result = Array.from({ length: parts.length }, (_, index) => {
    const part = parts[index];
    if (!Object.hasOwn(parts, index) || !plain(part) || Object.keys(part).some(key => !['id', 'selector', 'selectorBySide', 'repeat'].includes(key))) throw new Error('target.layout.parts holds an object with id, selector, optional selectorBySide and optional repeat');
    if (typeof part.id !== 'string' || !PART_ID.test(part.id)) throw new Error('target.layout.parts id must be a safe ID');
    if (ids.has(part.id)) throw new Error('target.layout.parts IDs must be unique');
    ids.add(part.id);
    if (!bounded(part.selector, 2048)) throw new Error('target.layout.parts selector must be bounded text');
    if (part.repeat !== undefined && typeof part.repeat !== 'boolean') throw new Error('target.layout.parts repeat must be boolean');
    let bySide;
    if (part.selectorBySide !== undefined) {
      if (!plain(part.selectorBySide)) throw new Error('target.layout.parts selectorBySide must be an object');
      const entries = Object.entries(part.selectorBySide);
      if (entries.length < 1 || entries.length > MAX_SIDE_SELECTORS) throw new Error(`target.layout.parts selectorBySide must have 1..${MAX_SIDE_SELECTORS} entries`);
      for (const [side, selector] of entries) {
        if (!SIDE_ID.test(side)) throw new Error('target.layout.parts selectorBySide keys must be side IDs');
        if (sides !== null && !sides.includes(side)) throw new Error(`target.layout.parts selectorBySide has unknown side ${side}`);
        if (!bounded(selector, 2048)) throw new Error('target.layout.parts selectorBySide selector must be bounded text');
      }
      bySide = Object.fromEntries(entries.sort(([x], [y]) => x < y ? -1 : 1));
    }
    return { id: part.id, selector: part.selector, ...(bySide ? { selectorBySide: bySide } : {}), ...(part.repeat === true ? { repeat: true } : {}) };
  });
  return { parts: result };
}

// The parts as one side reads them: the selector of `selectorBySide[side]`, else `selector` (#350, part C).
// Pure. The capture of a browser side and the import of a `claude-design` side both call it with their own side ID.
export function partsForSide(declaration, side) {
  return { parts: declaration.parts.map(part => ({ id: part.id, selector: Object.hasOwn(part.selectorBySide ?? {}, side) ? part.selectorBySide[side] : part.selector,
    ...(part.repeat === true ? { repeat: true } : {}) })) };
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
