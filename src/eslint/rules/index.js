/**
 * portadesign ESLint plugin — rule registry.
 *
 * Each rule is its own file. The plugin shape is `{ rules: { name: rule } }`
 * per ESLint v9 flat-config plugin convention. The rule names and the
 * `portadesign` namespace are frozen (R13.40): project configs and disable
 * comments name them.
 *
 * Adding a rule:
 *   1. Create `rules/<rule-name>.js`.
 *   2. Add `import` + `rules` entry below.
 *   3. Enable it in `../config.js`.
 *   4. Add a test in `tests/lint-cases/eslint-rules.mjs`.
 */

import noTopLevelHeavyLibImport from "./no-top-level-heavy-lib-import.js";
import noDeprecatedDependency from "./no-deprecated-dependency.js";
import noTopLevelThrow from "./no-top-level-throw.js";
import requireReducedMotionGuard from "./require-reduced-motion-guard.js";

export default {
	rules: {
		"no-top-level-heavy-lib-import": noTopLevelHeavyLibImport,
		"no-deprecated-dependency": noDeprecatedDependency,
		"no-top-level-throw": noTopLevelThrow,
		"require-reduced-motion-guard": requireReducedMotionGuard,
	},
};
