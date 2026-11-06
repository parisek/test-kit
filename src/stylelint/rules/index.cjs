/**
 * portadesign Stylelint plugin — rule registry.
 *
 * Each rule is its own `.cjs` file that exports `stylelint.createPlugin(...)`.
 * The array below goes to the `plugins` key of the shared config.
 *
 * The `.cjs` extension is mandatory: the package declares `"type": "module"`,
 * so Node treats every `.js` file as ESM and `module.exports = ...` would fail
 * with `ReferenceError: module is not defined`.
 *
 * The rule names and the `portadesign` namespace are frozen (R13.40).
 *
 * Adding a rule:
 *   1. Create `rules/<rule-name>.cjs`.
 *   2. Append `require("./<rule-name>.cjs")` to the array below.
 *   3. Enable it in `../config.cjs`.
 *   4. Add a test in `tests/unit/stylelint-rules.test.js`.
 */

module.exports = [
	require("./no-duplicate-import.cjs"),
	require("./no-undefined-tailwind-prose.cjs"),
	require("./prefer-utility-over-apply.cjs"),
	require("./import-order.cjs"),
	require("./no-length-division.cjs"),
];
