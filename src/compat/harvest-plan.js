const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LIMIT = 20000;
function fail(message) { throw new Error(`Invalid legacy harvest: ${message}`); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
}
function name(value, field) {
  if (typeof value !== 'string' || !NAME.test(value)) fail(`${field} must be a safe bounded name`);
  return value;
}
function list(value, field, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${field} must be a bounded array`);
  return value;
}

/** Normalize only the FORCE environment value. Other values keep references. */
export function legacyHarvestForce(value) {
  if (value !== undefined && typeof value !== 'string') fail('FORCE must be text');
  return ['1', 'true', 'yes'].includes((value ?? '').toLowerCase());
}

/** Plan reference writes from parsed data. This function has no filesystem or browser. */
export function planLegacyHarvest(input) {
  object(input, 'input');
  for (const key of Object.keys(input)) if (!['manifest', 'viewports', 'existing', 'names', 'type', 'force'].includes(key)) fail(`${key} is unsupported`);
  const { manifest, viewports, existing = {}, names = [], type, force = false } = input;
  if (typeof force !== 'boolean') fail('force must be boolean');
  if (type !== undefined && !['page', 'component'].includes(type)) fail('type must be page or component');
  object(viewports, 'viewports');
  const viewportIds = Object.keys(viewports).map(value => name(value, 'viewport'));
  if (!viewportIds.length || viewportIds.length > 20) fail('viewports must contain 1..20 entries');
  const entries = list(manifest, 'manifest', 1000);
  if (!entries.length) fail('manifest must contain entries');
  const selected = new Set(list(names, 'names', 1000).map(value => name(value, 'requested name')));
  object(existing, 'existing');
  const references = new Map();
  let count = 0;
  for (const [viewport, files] of Object.entries(existing)) {
    if (!viewportIds.includes(viewport)) fail('existing references use an unknown viewport');
    const set = new Set();
    for (const file of list(files, 'existing files', LIMIT)) {
      if (typeof file !== 'string' || file.length > 274 || !/^(component|page)-[A-Za-z0-9][A-Za-z0-9_-]*\.png$/.test(file)) fail('existing reference must be a safe PNG basename');
      if (++count > LIMIT) fail('existing references exceed the limit');
      set.add(file);
    }
    references.set(viewport, set);
  }
  const rows = [], identities = new Set();
  for (const entry of entries) {
    object(entry, 'manifest entry');
    const component = name(entry.component, 'component');
    const kind = entry.type ?? 'component';
    if (!['page', 'component'].includes(kind)) fail('manifest type must be page or component');
    const variant = entry.variant === undefined || entry.variant === '' ? undefined : name(entry.variant, 'variant');
    const ids = entry.viewports === undefined ? viewportIds : list(entry.viewports, 'entry viewports', 20).map(value => name(value, 'entry viewport'));
    if (new Set(ids).size !== ids.length || ids.some(id => !viewportIds.includes(id))) fail('entry viewports must be unique known IDs');
    // Harvest selects literal component names. Compare has a separate variant seam.
    if ((selected.size && !selected.has(component)) || (type && type !== kind)) continue;
    const label = `${kind}-${component}${variant === undefined ? '' : `--${variant}`}`;
    const filename = `${label}.png`;
    for (const viewport of ids) {
      const identity = `${viewport}/${filename}`;
      if (identities.has(identity)) fail('manifest writes the same reference twice');
      identities.add(identity);
      rows.push({ label, kind, component, ...(variant === undefined ? {} : { variant }), viewport, filename,
        action: !force && references.get(viewport)?.has(filename) ? 'keep' : 'capture' });
    }
  }
  return { rows, kept: rows.filter(row => row.action === 'keep').length, capture: rows.filter(row => row.action === 'capture').length };
}
