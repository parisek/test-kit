// Reads component targets from a styleguide catalogue (R13.3).
// Pure: no file system, no network, no DOM (R4.4). A caller passes the fetch.
// The package has no dependency on the styleguide code (R13.4, R13.5): it reads JSON only.

export const DEFAULT_MOUNT = '/styleguide';
export const MAX_COMPONENTS = 1000;
export const MAX_VARIANTS = 100;
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const VARIANT = /^[a-z0-9-]{1,64}$/;
const MOUNT = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;

export class StyleguideError extends Error {
  constructor(code, message) { super(message); this.name = 'StyleguideError'; this.code = code; }
}

// Text from a catalogue is untrusted. Keep it short and printable before it enters a message.
function shown(value) {
  const text = typeof value === 'string' ? value : typeof value;
  return JSON.stringify(text.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 40));
}

export function validMount(value) {
  return typeof value === 'string' && value.length <= 200 && MOUNT.test(value) && !value.split('/').some(part => part === '.' || part === '..');
}

function base(mount) { return mount === '/' ? '' : mount; }

export function componentsUrl(origin, mount = DEFAULT_MOUNT) {
  return new URL(`${base(mount)}/api/components`, origin).href;
}

// A render path stays on the origin. `?canvas` removes the back bar of the render page.
export function componentPath(id, mount = DEFAULT_MOUNT, variant) {
  return `${base(mount)}/render/component/${id}?canvas${variant ? `&variant=${variant}` : ''}`;
}

export function pagesUrl(origin, mount = DEFAULT_MOUNT) {
  return new URL(`${base(mount)}/api/pages`, origin).href;
}

// A page preview renders at `<mount>/render/page/<id>`. `?variant=` selects `styleguide.<variant>.twig`.
export function pagePath(id, mount = DEFAULT_MOUNT, variant) {
  return `${base(mount)}/render/page/${id}?canvas${variant ? `&variant=${variant}` : ''}`;
}

// Index one catalogue list by ID. A bad list throws. An entry with no usable id is never skipped: the whole read fails and names it.
function indexEntries(payload, noun, { allowEmpty = false } = {}) {
  if (!Array.isArray(payload)) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide ${noun} list is not an array.`);
  if (payload.length > MAX_COMPONENTS) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide lists more than ${MAX_COMPONENTS} ${noun}s.`);
  const bad = [];
  const seen = new Map();
  payload.forEach((entry, index) => {
    const id = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.id : undefined;
    if (typeof id !== 'string' || !ID.test(id)) { bad.push(`entry ${index} (id ${shown(id)})`); return; }
    if (seen.has(id)) { bad.push(`entry ${index} (duplicate id ${shown(id)})`); return; }
    seen.set(id, entry);
  });
  if (bad.length) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide lists ${bad.length} ${noun}(s) with no usable ID: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', ...' : ''}. An ID is 1 to 64 letters, digits, "_" or "-", and starts with a letter or digit.`);
  if (!seen.size && !allowEmpty) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide lists no ${noun}.`);
  return seen;
}

function boundedTitle(name, fallback) {
  return typeof name === 'string' && name.trim() && name.length <= 200 && !/[\x00-\x1f\x7f]/.test(name) ? name : fallback;
}

// The `variants` field of an entry: `[{ id, title, description }]`. A bad field throws and names the entry.
function variantsOf(entry, owner) {
  const list = entry.variants;
  if (list === undefined || (Array.isArray(list) && !list.length)) return [];
  if (!Array.isArray(list) || list.length > MAX_VARIANTS) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The variants of ${shown(owner)} are not a list of at most ${MAX_VARIANTS}.`);
  const seen = new Set();
  return list.map(item => {
    const id = item && typeof item === 'object' && !Array.isArray(item) ? item.id : undefined;
    if (typeof id !== 'string' || !VARIANT.test(id) || seen.has(id)) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `${shown(owner)} lists a variant with no usable ID (${shown(id)}). A variant ID is 1 to 64 lowercase letters, digits or "-", and unique.`);
    seen.add(id);
    return { id, title: item.title };
  });
}

// One entry gives its default target and, with `variants`, one target for each variant.
// The target ID is `<id>` and `<id>--<variant>`. A page uses `page--<id>` and `page--<id>--<variant>`, so a page never collides with a component.
// With `variants` set, a default target exists only when the entry has a default fixture (`has_default_variant`), because the grid shows no default tile otherwise.
function entryTargets(entry, { kind, mount, variants }) {
  const prefix = kind === 'page' ? 'page--' : '';
  const path = kind === 'page' ? pagePath : componentPath;
  const name = boundedTitle(entry.name, entry.id);
  const found = variants ? variantsOf(entry, entry.id) : [];
  const targets = [];
  if (!found.length || entry.has_default_variant !== false) targets.push({ id: `${prefix}${entry.id}`, kind, title: name, path: path(entry.id, mount) });
  for (const variant of found) {
    const title = `${name} / ${boundedTitle(variant.title, variant.id)}`;
    targets.push({ id: `${prefix}${entry.id}--${variant.id}`, kind, title: title.length <= 200 ? title : `${prefix}${entry.id}--${variant.id}`, path: path(entry.id, mount, variant.id), owner: `${prefix}${entry.id}` });
  }
  return targets;
}

// Turn the parsed `/api/components` payload, and optionally the parsed `/api/pages` payload, into targets.
// A bad catalogue throws. An entry with `has_styleguide: false` has nothing to render. It makes no target and sends no request.
// It is listed in `noFixture`, so the run manifest and the report name it (owner decision, #94).
// `variants: true` adds one target for each `styleguide.<variant>.twig` of an entry. `pages` is the parsed page list (opt-in).
// `include` names target IDs. A component ID also selects its variants, and `page--<id>` also selects the variants of a page.
export function parseComponents(payload, { mount = DEFAULT_MOUNT, include, variants = false, pages } = {}) {
  const components = indexEntries(payload, 'component');
  const pageEntries = pages === undefined ? new Map() : indexEntries(pages, 'page', { allowEmpty: true });
  const all = [];
  const noFixture = new Set();
  const known = new Set();
  const add = (entries, kind) => {
    for (const entry of entries.values()) {
      const prefix = kind === 'page' ? 'page--' : '';
      known.add(`${prefix}${entry.id}`);
      if (entry.has_styleguide === false) { noFixture.add(`${prefix}${entry.id}`); continue; }
      for (const target of entryTargets(entry, { kind, mount, variants })) { known.add(target.id); all.push(target); }
    }
  };
  add(components, 'component');
  add(pageEntries, 'page');
  const clash = new Set();
  const ids = new Set();
  for (const target of all) { if (ids.has(target.id) || !ID.test(target.id)) clash.add(target.id); ids.add(target.id); }
  if (clash.size) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide makes ${clash.size} target ID(s) that are repeated or longer than 64 characters: ${[...clash].slice(0, 5).map(shown).join(', ')}${clash.size > 5 ? ', ...' : ''}.`);
  if (include !== undefined) {
    const unknown = include.filter(id => !known.has(id));
    if (unknown.length) throw new StyleguideError('STYLEGUIDE_COMPONENT_UNKNOWN', `The styleguide has no component ${unknown.slice(0, 5).map(shown).join(', ')}${unknown.length > 5 ? ', ...' : ''}.`);
  }
  const selected = target => include === undefined || include.includes(target.id) || include.includes(target.owner ?? '');
  const targets = all.filter(selected).map(({ owner, ...target }) => target).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (targets.length > MAX_COMPONENTS) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide makes ${targets.length} targets. The limit is ${MAX_COMPONENTS}. Narrow the run with include.`);
  const skipped = [...noFixture].filter(id => include === undefined || include.includes(id)).sort();
  if (!targets.length) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'No selected component or page has a fixture. Every one has has_styleguide false.');
  return { targets, noFixture: skipped };
}

async function readJson(url, noun, get) {
  let response;
  try { response = await get(url); }
  catch { throw new StyleguideError('STYLEGUIDE_CATALOGUE_UNREACHABLE', `The styleguide ${noun} list is unreachable. Check the side origin and the mount.`); }
  if (response?.status !== 200) throw new StyleguideError('STYLEGUIDE_CATALOGUE_UNREACHABLE', `The styleguide ${noun} list answers HTTP ${Number.isInteger(response?.status) ? response.status : 'none'}. Check the mount.`);
  if (typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_PAYLOAD_BYTES) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide ${noun} list is empty or too large.`);
  try { return JSON.parse(response.body); }
  catch { throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide ${noun} list is not JSON.`); }
}

// `get(url)` returns `{ status, body }` with `body` as text. The caller owns the transport and its limits.
// One GET reads the components. `pages: true` adds one GET for the page list.
export async function readComponents({ origin, mount = DEFAULT_MOUNT, include, variants = false, pages = false, get }) {
  const payload = await readJson(componentsUrl(origin, mount), 'component', get);
  const pagePayload = pages ? await readJson(pagesUrl(origin, mount), 'page', get) : undefined;
  return parseComponents(payload, { mount, include, variants, pages: pagePayload });
}
