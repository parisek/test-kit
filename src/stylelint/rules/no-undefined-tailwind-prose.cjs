/**
 * portadesign/no-undefined-tailwind-prose
 *
 * Catches `@apply <prose-*>` references to non-existent prose variants.
 * Tailwind v4 silently drops unknown utilities, so the line is dead and the
 * build "passes."
 *
 * `prose-base` was this docblock's own example of a dead utility, and it was
 * WRONG: @tailwindcss/typography ships `base` among its size modifiers, so the
 * line works wherever the plugin is loaded. The rule reported it on 9 real
 * call sites across 7 projects (2026-09-10), and acting on one of those
 * reports changed a live site's form text from 16px to 18px — a rendered
 * regression caused by the linter, not caught by it. A rule that decides what
 * "exists" has to be right about it.
 *
 * Allow-list (default): everything the plugin defines — DEFAULT, the five
 * sizes (sm, base, lg, xl, 2xl), `invert`, and the 22 colour themes.
 *
 * The rule auto-augments the allow-list from `@utility prose-<name> { … }`
 * declarations found in the same file. (Cross-file `@utility` detection
 * would require a custom syntax pass — same-file is the floor; expand if
 * false positives recur.)
 *
 * Project-level override:
 *   "portadesign/no-undefined-tailwind-prose": [true, { allow: ["prose-mega"] }]
 */

const stylelint = require("stylelint");

const ruleName = "portadesign/no-undefined-tailwind-prose";

const messages = stylelint.utils.ruleMessages(ruleName, {
	unknown: (className, valid) =>
		`Unknown prose variant "${className}". Tailwind v4 silently drops unknown utilities — this line compiles to nothing. ` +
		`Valid: ${valid.join(", ")}. Add via project config + \`@utility ${className} { … }\` if intentional.`,
});

// Everything @tailwindcss/typography actually ships, read off its own
// src/styles.js: DEFAULT, the five sizes, `invert`, and 22 colour themes.
// The list is the rule's whole claim to authority — it decides what "exists"
// means — so anything the plugin defines belongs here, used or not.
const DEFAULT_ALLOW = [
	"prose",
	// Sizes.
	"prose-sm",
	"prose-base",
	"prose-lg",
	"prose-xl",
	"prose-2xl",
	// Colour themes.
	"prose-invert",
	"prose-slate",
	"prose-gray",
	"prose-zinc",
	"prose-neutral",
	"prose-stone",
	"prose-red",
	"prose-orange",
	"prose-amber",
	"prose-yellow",
	"prose-lime",
	"prose-green",
	"prose-emerald",
	"prose-teal",
	"prose-cyan",
	"prose-sky",
	"prose-blue",
	"prose-indigo",
	"prose-violet",
	"prose-purple",
	"prose-fuchsia",
	"prose-pink",
	"prose-rose",
];

const PROSE_PATTERN = /(?<![a-zA-Z0-9_-])prose(?:-[a-z0-9-]+)?(?![a-zA-Z0-9_-])/g;
const VARIANT_PREFIX_PATTERN = /^(?:[a-z][a-z0-9-]*:)+/;

const ruleFunction = (primary, secondary) => (root, result) => {
	const validOptions = stylelint.utils.validateOptions(
		result,
		ruleName,
		{ actual: primary, possible: [true, false] },
		{
			actual: secondary,
			possible: { allow: [(v) => Array.isArray(v)] },
			optional: true,
		},
	);
	if (!validOptions || !primary) return;

	const allow = new Set([
		...DEFAULT_ALLOW,
		...((secondary && secondary.allow) || []),
	]);

	// Augment allow-list from @utility prose-<name> { … } declarations in this file.
	root.walkAtRules("utility", (atRule) => {
		const name = atRule.params.trim().split(/\s+/)[0];
		if (name && name.startsWith("prose-")) {
			allow.add(name);
		}
	});

	root.walkAtRules("apply", (atRule) => {
		const params = atRule.params;
		for (const match of params.matchAll(PROSE_PATTERN)) {
			const raw = match[0];
			// Strip variant prefixes (`hover:prose`, `lg:prose-sm`) — the underlying class is what matters.
			const stripped = raw.replace(VARIANT_PREFIX_PATTERN, "");
			if (!allow.has(stripped)) {
				stylelint.utils.report({
					message: messages.unknown(stripped, [...allow].sort()),
					node: atRule,
					result,
					ruleName,
					word: raw,
				});
			}
		}
	});
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

module.exports = stylelint.createPlugin(ruleName, ruleFunction);
