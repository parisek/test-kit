const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LIMIT = 10000;

function fail(message) { throw new Error(`Invalid legacy selection: ${message}`); }
function list(value, field) {
  if (!Array.isArray(value) || value.length > LIMIT) fail(`${field} must be an array with at most ${LIMIT} items`);
  return value;
}
function name(value, field) {
  if (typeof value !== 'string' || !NAME.test(value)) fail(`${field} must be a safe bounded name`);
  return value;
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
}

/** Plan legacy comparison labels. This function reads no files and starts no browser. */
export function planLegacySelection(input) {
  object(input, 'input');
  const fields = ['manifest', 'harvested', 'names', 'type', 'noReference'];
  for (const field of Object.keys(input)) if (!fields.includes(field)) fail(`${field} is unsupported`);
  const { manifest = [], harvested = [], names = [], type, noReference = [] } = input;
  if (type !== undefined && !['page', 'component'].includes(type)) fail('type must be page or component');
  const pages = new Set();
  const kinds = new Map();
  for (const entry of list(manifest, 'manifest')) {
    object(entry, 'manifest entry');
    const component = name(entry.component, 'manifest component');
    const kind = entry.type ?? 'component';
    if (!['page', 'component'].includes(kind)) fail('manifest type must be page or component');
    if (kinds.has(component) && kinds.get(component) !== kind) fail('manifest contains conflicting target kinds');
    kinds.set(component, kind);
    if (kind === 'page') pages.add(component);
  }
  const requested = new Set(list(names, 'names').map(value => name(value, 'requested name')));
  const missing = new Set(list(noReference, 'noReference').map(value => name(value, 'noReference name')));
  const labels = new Map();
  const measuredNames = [];
  for (const file of list(harvested, 'harvested')) {
    if (typeof file !== 'string' || file.length > 148) fail('harvested filename must be bounded text');
    const parsed = /^(component|page)-(.+)\.png$/.exec(file);
    if (!parsed) fail('harvested filename must have a target prefix and .png suffix');
    const bare = name(parsed[2], 'harvested name');
    const label = `${parsed[1]}-${bare}`;
    labels.set(label, { kind: parsed[1], bare, renderOnly: false });
    measuredNames.push(bare);
  }
  // Only original reference names decide whether a requested target needs a render.
  for (const target of requested.size ? requested : missing) {
    if (measuredNames.some(bare => bare === target || bare.startsWith(`${target}--`))) continue;
    const kind = pages.has(target) ? 'page' : 'component';
    labels.set(`${kind}-${target}`, { kind, bare: target, renderOnly: true });
  }
  const result = [];
  for (const [label, row] of labels) {
    if (type && row.kind !== type) continue;
    const boundary = row.bare.indexOf('--');
    const component = boundary === -1 ? row.bare : row.bare.slice(0, boundary);
    const variant = boundary === -1 ? undefined : row.bare.slice(boundary + 2);
    if (requested.size && !requested.has(component) && !requested.has(row.bare)) continue;
    result.push({ label, kind: row.kind, component, ...(variant !== undefined ? { variant } : {}), renderOnly: row.renderOnly });
  }
  return result;
}
