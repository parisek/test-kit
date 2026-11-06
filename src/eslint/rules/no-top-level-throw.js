/**
 * portadesign/no-top-level-throw
 *
 * Disallow `throw` statements at the top level of an ES module. A top-level
 * `throw` evaluates during ES-module instantiation; a missing DOM node — a
 * perfectly survivable condition for a per-component helper — then halts
 * every importer transitively, silently disabling unrelated features.
 *
 * A 2026-05 audit of a first consumer project traced site-wide animation outages to a top-level
 * `if (!pageWrapper) throw new Error("Missing .page-wrapper")` in a helper
 * imported by `gsap.js`. Every page lacking `.page-wrapper` lost all scroll
 * animations because the helper's module-load failure cascaded.
 *
 * Replacement patterns (rule does NOT auto-fix — pick per case):
 *
 *   // Instead of:
 *   if (!wrapper) throw new Error("Missing .page-wrapper");
 *
 *   // Use one of:
 *   if (!wrapper) return;                                     // Quiet abort — module exports a no-op
 *   if (!wrapper) console.warn("[scroll] Missing .page-wrapper");  // Loud abort — visible to dev tools
 *
 * Throws INSIDE exported functions are fine — they're invoked at call site,
 * not module-load. Same for arrow functions, methods, and closures.
 *
 * A top-level throw inside the `try` block of a `try`/`catch` is also fine:
 * the catch runs, instantiation completes, and no importer observes anything.
 * Top-level scripts legitimately use this to convert a per-item failure into a
 * counter, where rewriting the throws as `return`/`console.warn` per the advice
 * above would stop the run from counting failures at all. The exemption is positional: a throw in the
 * `catch` or `finally` block escapes its own try and is still reported.
 *
 * Severity: error. Module-load failures cascade across the bundle; a
 * disable comment for this rule should be exceptionally rare.
 */

const FUNCTION_NODE_TYPES = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunctionExpression",
	"MethodDefinition",
]);

export default {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow top-level throw statements — they halt ES-module " +
				"instantiation and cascade through every importer.",
		},
		schema: [],
		messages: {
			topLevelThrow:
				"Top-level `throw` halts module instantiation and propagates through every importer. " +
				"Replace with `return` (quiet abort) or `console.warn(...)` (loud abort).",
		},
	},

	create(context) {
		return {
			ThrowStatement(node) {
				// Walk up looking for the nearest function-like ancestor, or for a
				// try block that will catch this throw before it can escape.
				let child = node;
				let parent = node.parent;
				while (parent && parent.type !== "Program") {
					if (FUNCTION_NODE_TYPES.has(parent.type)) return;
					// A throw in the `block` of a try that HAS a handler is caught
					// locally: instantiation continues and no importer ever sees it,
					// so this rule's premise does not hold. Position matters — a
					// throw in the `handler` or the `finalizer` is NOT caught by its
					// own try and still escapes, which is why this compares against
					// `parent.block` rather than merely spotting a TryStatement.
					if (parent.type === "TryStatement" && parent.handler && parent.block === child) return;
					child = parent;
					parent = parent.parent;
				}
				// Reached Program — the throw is at module top level.
				context.report({
					node,
					messageId: "topLevelThrow",
				});
			},
		};
	},
};
