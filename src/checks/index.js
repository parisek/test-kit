import * as headingOutline from './builtin/heading-outline.js';
import * as lang from './builtin/lang.js';
import * as emptyAlt from './builtin/empty-alt.js';
import * as emptyTitle from './builtin/empty-title.js';
import * as internalLinks from './builtin/internal-links.js';
import * as textDifference from './builtin/text-difference.js';
export const CHECK_VERSION = '1.0.0';
export const builtinChecks = Object.freeze(Object.fromEntries([headingOutline, lang, emptyAlt, emptyTitle, internalLinks, textDifference].map(plugin => [plugin.id, plugin])));
export function runContentChecks(snapshot, ids, context = {}) {
  if (!Array.isArray(ids) || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error('Invalid content check selection.');
  const selected = ids.map(id => {
    if (!Object.hasOwn(builtinChecks, id)) throw new Error('Unknown content check.');
    return builtinChecks[id];
  });
  return selected.flatMap(plugin => plugin.check(snapshot, context));
}
