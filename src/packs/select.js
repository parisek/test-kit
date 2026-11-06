// Pure. Decides which selected packs `capture --packs` runs on the open page (R13.51).
// It imports no pack, no browser and no file system (R4.4). It runs nothing.
import { BUILTIN_PACK_IDS } from './ids.js';

// Packs that run on the page that capture already has open. The others have no page step today.
export const PAGE_PACK_IDS = Object.freeze(['a11y']);
const NO_PAGE_STEP = Object.freeze({
  lint: 'The lint pack reads project files, not a page. Run it from your own script (src/packs/lint).',
  swiper: 'The swiper pack needs DOM facts and a library version. No browser step collects them yet (specification section 17, item 9).',
});

// `selected` is `config.packs`. It returns { selected, page, skipped } or throws a clear error.
// A pack that has no page step is `skipped` with a diagnostic. It is never reported as run (R8.7).
export function planPackRun(selected, { remote = false } = {}) {
  // axe runs inside the page. A hostile page can fake a clean result (src/packs/a11y/README.md), so a remote side refuses it.
  if (remote) throw new Error('--packs is not allowed on a remote side: the pack injects a script into a page you do not control. Use a local side (R13.51).');
  if (!Array.isArray(selected) || selected.length === 0) throw new Error('--packs needs a "packs" key in the configuration, for example "packs": ["a11y"] (R13.44, R13.51).');
  const ids = [...selected];
  if (ids.some(id => !BUILTIN_PACK_IDS.includes(id))) throw new Error(`Unknown pack (known: ${BUILTIN_PACK_IDS.join(', ')}).`);
  return {
    selected: ids,
    page: ids.filter(id => PAGE_PACK_IDS.includes(id)),
    skipped: ids.filter(id => !PAGE_PACK_IDS.includes(id)).map(id => ({ id, diagnostic: NO_PAGE_STEP[id] ?? 'The pack has no page step.' })),
  };
}
