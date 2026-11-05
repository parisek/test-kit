// Recorded selection of a run (R4.5). Pure logic: no file system, no browser.
// A selection limits which cells (target x viewport) a run captured. It never changes the settings
// or their hash. The run keeps the full target and viewport lists.
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export const MAX_SELECTED_TARGETS = 1000;
export const MAX_SELECTED_VIEWPORTS = 20;
const AXES = Object.freeze([['targets', 'targets', MAX_SELECTED_TARGETS], ['viewports', 'viewports', MAX_SELECTED_VIEWPORTS]]);

// Parse `ID,ID` from the command line. Shared by `capture` and `diff` (the same rule as `selectConfig`).
export function parseIdList(value, name) {
  const values = value.split(',');
  if (!values.length || new Set(values).size !== values.length || values.some(id => !ID.test(id))) throw new Error(`Invalid ${name} selection.`);
  return values;
}

// Build the selection of a new run from IDs. Order follows the configuration, so the record is stable.
// Returns null when no axis is selected. A run with no selection is a full run.
export function recordSelection(settings, { targets, viewports } = {}) {
  const selection = {};
  for (const [axis, name] of [['targets', 'target'], ['viewports', 'viewport']]) {
    const requested = axis === 'targets' ? targets : viewports;
    if (requested === undefined) continue;
    if (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length || requested.some(id => typeof id !== 'string' || !ID.test(id))) throw new Error(`Invalid ${name} selection.`);
    const known = new Set(settings[axis].map(row => row.id));
    if (requested.some(id => !known.has(id))) throw new Error(`Unknown ${name}.`);
    selection[axis] = settings[axis].map(row => row.id).filter(id => requested.includes(id));
  }
  return Object.keys(selection).length ? selection : null;
}

// True when the value has the shape of a selection: a plain object with at least one known axis,
// each a non-empty, bounded list of unique, safe IDs. It needs no settings, so a report reader uses it too.
export function selectionShapeValid(selection) {
  if (selection === null || typeof selection !== 'object' || Array.isArray(selection)) return false;
  const keys = Object.keys(selection);
  if (!keys.length || keys.some(key => !AXES.some(([axis]) => axis === key))) return false;
  return AXES.every(([axis, , max]) => {
    const list = selection[axis];
    return list === undefined || (Array.isArray(list) && list.length > 0 && list.length <= max && new Set(list).size === list.length
      && list.every(id => typeof id === 'string' && ID.test(id)));
  });
}

// Check a stored selection against the stored settings. Throws on any problem (R8.9: no guess from a bad record).
export function validateSelection(selection, settings) {
  if (!selectionShapeValid(selection)) throw new Error('Invalid stored selection.');
  for (const [axis] of AXES) {
    const known = new Set(settings[axis].map(row => row.id));
    if (selection[axis]?.some(id => !known.has(id))) throw new Error('Invalid stored selection.');
  }
  return selection;
}

// True when the cell lies inside the selection. No selection means every cell: it is not a selection.
export function cellSelected(selection, targetId, viewportId) {
  if (selection === null || selection === undefined) return true;
  return (selection.targets === undefined || selection.targets.includes(targetId))
    && (selection.viewports === undefined || selection.viewports.includes(viewportId));
}
