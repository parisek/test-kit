// Pure. Maps the built-in pack IDs to pack objects, for `resolveChecks` (R13.42, R13.44).
// It runs nothing. A project selects packs with the `packs` key of its configuration (G3, R5.1).
import { a11yPack } from './a11y/index.js';
import { lintPack } from './lint/index.js';
import { swiperPack } from './versioned/swiper.js';

export { BUILTIN_PACK_IDS } from './ids.js';
export const builtinPacks = Object.freeze([a11yPack, lintPack, swiperPack]);
