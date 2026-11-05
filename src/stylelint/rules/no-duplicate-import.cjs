/**
 * portadesign/no-duplicate-import
 *
 * Disallow duplicate `@import` of the same source within a single CSS file.
 *
 * A CSS file can `@import` the same dependency twice with different
 * `layer(…)` attributions, and one wins the cascade silently. A 2026-05
 * audit of a first consumer project found `header.css` imported twice in `style.css` (once via
 * `settings.css` in `layer(components)`, once unlayered). The unlayered
 * duplicate beat every utility class applied to header elements.
 *
 * The check resolves relative paths against the file's directory before
 * comparison so logically-equivalent paths (`./settings.css`,
 * `../css/settings.css`) aren't reported as distinct.
 */

const stylelint = require("stylelint");
const path = require("node:path");

const ruleName = "portadesign/no-duplicate-import";

const messages = stylelint.utils.ruleMessages(ruleName, {
	duplicate: (src, firstLine) =>
		`Duplicate @import of "${src}" (first imported at line ${firstLine}). The duplicate silently wins the cascade — pick one and remove the other.`,
});

const ruleFunction = (primary) => (root, result) => {
	const validOptions = stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: [true, false],
	});
	if (!validOptions || !primary) return;

	const seen = new Map();
	const fromPath = result.opts.from || ".";
	const fromDir = path.dirname(fromPath);

	root.walkAtRules("import", (atRule) => {
		// `@import` param looks like:  "path"  or  'path' layer(name)  or  url("path")
		// Strip whitespace, quotes, url(), then take the first path-like token.
		let src = atRule.params.trim();
		src = src.replace(/^url\(\s*["']?([^"')]+)["']?\s*\)/, "$1");
		src = src.replace(/^["']?([^"'\s)]+)["']?.*$/, "$1");
		if (!src) return;

		// Resolve relative paths against the file location.
		const resolved = src.startsWith(".") ? path.resolve(fromDir, src) : src;

		if (seen.has(resolved)) {
			const firstLine = seen.get(resolved);
			stylelint.utils.report({
				message: messages.duplicate(src, firstLine),
				node: atRule,
				result,
				ruleName,
				word: src,
			});
			// keep `firstLine` recorded — multiple subsequent duplicates report against the first
			return;
		}
		seen.set(resolved, atRule.source && atRule.source.start && atRule.source.start.line);
	});
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

module.exports = stylelint.createPlugin(ruleName, ruleFunction);
