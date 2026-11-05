// Reads component targets from a styleguide catalogue (R13.3).
// Pure: no file system, no network, no DOM (R4.4). A caller passes the fetch.
// The package has no dependency on the styleguide code (R13.4, R13.5): it reads JSON only.

export const DEFAULT_MOUNT = '/styleguide';
export const MAX_COMPONENTS = 1000;
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
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
export function componentPath(id, mount = DEFAULT_MOUNT) {
  return `${base(mount)}/render/component/${id}?canvas`;
}

// Turn a parsed `/api/components` payload into targets.
// A bad catalogue throws. An entry with no usable id is never skipped: the whole read fails and names it.
// An entry with `has_styleguide: false` has nothing to render. It makes no target and sends no request.
// It is listed in `noFixture`, so the run manifest and the report name it (owner decision, #94).
export function parseComponents(payload, { mount = DEFAULT_MOUNT, include } = {}) {
  if (!Array.isArray(payload)) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'The styleguide component list is not an array.');
  if (payload.length > MAX_COMPONENTS) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide lists more than ${MAX_COMPONENTS} components.`);
  const bad = [];
  const seen = new Map();
  payload.forEach((entry, index) => {
    const id = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.id : undefined;
    if (typeof id !== 'string' || !ID.test(id)) { bad.push(`entry ${index} (id ${shown(id)})`); return; }
    if (seen.has(id)) { bad.push(`entry ${index} (duplicate id ${shown(id)})`); return; }
    seen.set(id, entry);
  });
  if (bad.length) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', `The styleguide lists ${bad.length} component(s) with no usable ID: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', ...' : ''}. An ID is 1 to 64 letters, digits, "_" or "-", and starts with a letter or digit.`);
  if (!seen.size) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'The styleguide lists no component.');
  if (include !== undefined) {
    const unknown = include.filter(id => !seen.has(id));
    if (unknown.length) throw new StyleguideError('STYLEGUIDE_COMPONENT_UNKNOWN', `The styleguide has no component ${unknown.slice(0, 5).map(shown).join(', ')}${unknown.length > 5 ? ', ...' : ''}.`);
  }
  const ids = [...seen.keys()].filter(id => include === undefined || include.includes(id)).sort();
  const noFixture = ids.filter(id => seen.get(id).has_styleguide === false);
  const skipped = new Set(noFixture);
  if (ids.length === skipped.size) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'No selected component has a fixture. Every one has has_styleguide false.');
  const targets = ids.filter(id => !skipped.has(id)).map(id => {
    const name = seen.get(id).name;
    const title = typeof name === 'string' && name.trim() && name.length <= 200 && !/[\x00-\x1f\x7f]/.test(name) ? name : id;
    return { id, kind: 'component', title, path: componentPath(id, mount) };
  });
  return { targets, noFixture };
}

// `get(url)` returns `{ status, body }` with `body` as text. The caller owns the transport and its limits.
export async function readComponents({ origin, mount = DEFAULT_MOUNT, include, get }) {
  const url = componentsUrl(origin, mount);
  let response;
  try { response = await get(url); }
  catch { throw new StyleguideError('STYLEGUIDE_CATALOGUE_UNREACHABLE', 'The styleguide component list is unreachable. Check the side origin and the mount.'); }
  if (response?.status !== 200) throw new StyleguideError('STYLEGUIDE_CATALOGUE_UNREACHABLE', `The styleguide component list answers HTTP ${Number.isInteger(response?.status) ? response.status : 'none'}. Check the mount.`);
  if (typeof response.body !== 'string' || Buffer.byteLength(response.body) > MAX_PAYLOAD_BYTES) throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'The styleguide component list is empty or too large.');
  let payload;
  try { payload = JSON.parse(response.body); }
  catch { throw new StyleguideError('STYLEGUIDE_CATALOGUE_INVALID', 'The styleguide component list is not JSON.'); }
  return parseComponents(payload, { mount, include });
}
