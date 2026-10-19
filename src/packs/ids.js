// Pure. The IDs of the packs that ship in the package. The config reads this list only (R13.44).
// It imports no pack, so the config stays light. `builtin.js` maps each ID to its pack object.
export const BUILTIN_PACK_IDS = Object.freeze(['a11y', 'lint', 'swiper']);
