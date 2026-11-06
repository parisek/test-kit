/**
 * portadesign/import-order
 *
 * Enforces the canonical at-rule order at the top level of a CSS file:
 *
 *   1. @import "tailwindcss"             (zero or one)
 *   2. @plugin "…"                       (zero or more)
 *   3. @config "…"                       (zero or one)
 *   4. @source "…"                       (zero or more)
 *   5. @custom-variant <name> (…)        (zero or more)
 *   6. @import "…" (project, non-tailwind)
 *   7. @theme { … }                      (zero or one)
 *   8. @utility / @layer                  (any order; both express layered intent)
 *   9. Bare selectors at top level        (last; usually inside @layer)
 *
 * A 2026-05 audit of a first consumer project found `@source "../../templates/**\/*.vue"` placed
 * before `@config` — works empirically but only by accident. Tailwind v4's
 * source-detection pass reads `@config` before scanning, so out-of-order
 * `@source` directives can silently miss the configured purge paths.
 *
 * Constraint scope: TOP-LEVEL only. Nested at-rules (e.g., `@media` inside
 * `@layer`) are unaffected — this rule reasons about the file's outer
 * sequence, not its inner structure.
 *
 * Rule is permissive within slots — two `@plugin` declarations in any
 * relative order is fine; only inter-slot ordering is enforced.
 */

const stylelint = require("stylelint");

const ruleName = "portadesign/import-order";

const messages = stylelint.utils.ruleMessages(ruleName, {
	wrongOrder: (current, currentSlot, earlier, earlierSlot) =>
		`\`${current}\` (slot ${currentSlot}: ${slotName(currentSlot)}) appears after \`${earlier}\` ` +
		`(slot ${earlierSlot}: ${slotName(earlierSlot)}). Reorder so slot ${currentSlot} comes before slot ${earlierSlot}.`,
});

const SLOTS = {
	"@import tailwindcss": 1,
	"@plugin": 2,
	"@config": 3,
	"@source": 4,
	"@custom-variant": 5,
	"@import": 6,
	"@theme": 7,
	"@utility": 8,
	"@layer": 8,
};

function slotName(slot) {
	const entries = Object.entries(SLOTS)
		.filter(([, n]) => n === slot)
		.map(([k]) => k);
	return entries.join(" / ");
}

function classify(node) {
	// Comments don't participate in slot ordering.
	if (node.type === "comment") return null;
	if (node.type !== "atrule") return 9; // bare selectors / declarations
	const name = "@" + node.name;
	if (name === "@import") {
		const params = node.params.trim();
		const isTailwind = /["']tailwindcss["']/.test(params) || /^tailwindcss/.test(params);
		return isTailwind ? 1 : 6;
	}
	if (SLOTS[name] !== undefined) return SLOTS[name];
	return 9; // unknown at-rules treated as content
}

const ruleFunction = (primary) => (root, result) => {
	const validOptions = stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: [true, false],
	});
	if (!validOptions || !primary) return;

	let maxSlotSeen = 0;
	let maxSlotNode = null;

	root.each((node) => {
		const slot = classify(node);
		if (slot === null) return; // comments / non-participating nodes
		if (slot < maxSlotSeen) {
			const currentText = `@${node.name || "rule"} ${(node.params || node.selector || "").slice(0, 40)}`.trim();
			const earlierText = `@${maxSlotNode.name || "rule"} ${(maxSlotNode.params || maxSlotNode.selector || "").slice(0, 40)}`.trim();
			stylelint.utils.report({
				message: messages.wrongOrder(currentText, slot, earlierText, maxSlotSeen),
				node,
				result,
				ruleName,
			});
		} else {
			maxSlotSeen = slot;
			maxSlotNode = node;
		}
	});
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

module.exports = stylelint.createPlugin(ruleName, ruleFunction);
