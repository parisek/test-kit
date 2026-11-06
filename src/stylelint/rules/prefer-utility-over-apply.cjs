/**
 * portadesign/prefer-utility-over-apply
 *
 * Warns when a plain CSS class selector consists entirely of `@apply` rules
 * — these should be `@utility <name> { … }` instead. The `@utility` form
 * participates in Tailwind's variant generation (`lg:name`, `hover:name`,
 * `dark:name`) for free; the plain `.name` form doesn't, and refactoring
 * later is expensive.
 *
 * A 2026-05 audit of a first consumer project found `prose-indent` declared as a plain class — it
 * can't gain responsive variants without a refactor.
 *
 * False-positive guards (rule does NOT fire when):
 *  - Selector contains a pseudo-class / pseudo-element (`:hover`, `::before`, etc.)
 *  - Selector is inside `@media` / `@container` / `@supports` (state, not utility)
 *  - Selector name starts with a documented framework prefix (`wp-`, `wpforms-`,
 *    `js-`, `is-`, `has-`)
 *  - Selector has nested rules beyond @apply (the @apply is one of many things,
 *    not the only thing)
 *
 * Severity: warning (this is a refactor recommendation, not a fix).
 */

const stylelint = require("stylelint");

const ruleName = "portadesign/prefer-utility-over-apply";

const messages = stylelint.utils.ruleMessages(ruleName, {
	prefer: (name) =>
		`Class \`${name}\` is a pure @apply aggregation — prefer \`@utility ${name.replace(/^\./, "")} { … }\` ` +
		"so the class gains free variant generation (lg:, hover:, dark:, …).",
});

const FRAMEWORK_PREFIXES = ["wp-", "wpforms-", "js-", "is-", "has-", "wc-", "elementor-"];

const ruleFunction = (primary, secondary) => (root, result) => {
	const validOptions = stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: [true, false],
	});
	if (!validOptions || !primary) return;

	root.walkRules((rule) => {
		// Skip rules inside conditional at-rules (@media, @container, @supports, @layer …).
		// These represent state-conditional styling, not utility candidates.
		// Also skip nested rules — `.parent { .child { @apply x; } }`'s .child is scoped
		// styling under another selector, not a top-level utility candidate.
		let parent = rule.parent;
		while (parent && parent.type !== "root") {
			if (parent.type === "atrule" && parent.name !== "utility") {
				return;
			}
			if (parent.type === "rule") {
				return; // nested under another selector
			}
			parent = parent.parent;
		}

		// Must be a simple class selector with no pseudo / combinator.
		const selector = rule.selector.trim();
		if (!/^\.[a-zA-Z_][\w-]*$/.test(selector)) return;

		const className = selector.slice(1);
		if (FRAMEWORK_PREFIXES.some((p) => className.startsWith(p))) return;

		// Inspect children — must be at-rules and all of them @apply.
		let applyCount = 0;
		let otherCount = 0;
		rule.walk((child) => {
			if (child.type === "atrule" && child.name === "apply") {
				applyCount++;
			} else if (child.type === "decl") {
				otherCount++;
			} else if (child.type === "rule") {
				// Nested selector — not a pure aggregation.
				otherCount++;
			}
		});

		if (applyCount > 0 && otherCount === 0) {
			stylelint.utils.report({
				message: messages.prefer(selector),
				node: rule,
				result,
				ruleName,
				severity: "warning",
			});
		}
	});
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

module.exports = stylelint.createPlugin(ruleName, ruleFunction);
