/**
 * portadesign/require-reduced-motion-guard
 *
 * A file that imports an animation library DIRECTLY must honour
 * `prefers-reduced-motion` itself.
 *
 * A project entry script usually gates the shared GSAP runtime on the preference:
 *
 *   if (window.matchMedia?.("(prefers-reduced-motion: no-preference)")?.matches) {
 *     import("./gsap");
 *   }
 *
 * That gate covers the SHARED RUNTIME ONLY. A component writing
 * `import gsap from "gsap"` in its own `js/<name>.js` gets its own module
 * instance and animates regardless — the visitor asked not to be moved, and we
 * move them anyway (WCAG 2.3.3). A 2026-07 measurement across 19 projects of one
 * team found 95 of 112 direct-import files with no guard at all.
 *
 * WHY THIS RULE EXISTS SEPARATELY FROM `no-top-level-heavy-lib-import`
 *
 * That rule was incidentally preventing this, by forbidding direct import and
 * so pushing components onto the shared (gated) runtime. But its documentation
 * and message speak only about bundle weight and the single-runtime invariant.
 * When a project disabled it in 2026-07 — on measured grounds: the
 * auto-loader already lazy-loads component modules, and the bundler dedupes the
 * specifier — the a11y obligation transferred silently, because nothing had
 * ever written it down. This rule makes that obligation explicit and
 * independent of the other rule's fate.
 *
 * ANIMATION libraries only. `vue`, `pinia`, `@floating-ui/dom` are heavy but
 * do not move anything on their own; including them would produce noise, and a
 * mostly-wrong check is worse than no check.
 *
 * Satisfied by any mention of `prefers-reduced-motion` in CODE — comments do
 * not count. A file that merely talks about the preference in a docblock is
 * exactly the file this rule exists to catch; matching raw source text made
 * this rule's own fixture pass on the first run (2026-07), because the
 * fixture's header comment named the token.
 *
 * Within code the check is deliberately loose — any reference satisfies it.
 * The correct response differs per component and no predicate can judge it:
 * `map-pulse` is right to do nothing, while `ph-bar-chart` is right only if it
 * PAINTS, since its bars start at `height: 0` and skipping the animation would
 * leave the chart blank. The rule asks for the decision to exist, not for a
 * particular shape.
 *
 * Opt-out, in order of preference:
 *   1. Guard the motion.
 *   2. `// eslint-disable-next-line portadesign/require-reduced-motion-guard --
 *      <reason>` where nothing actually moves (a pin is layout; a colour fade is
 *      not a vestibular trigger). The reason is mandatory.
 *   3. `// portadesign/heavy-lib-runtime-owner` for the single canonical runtime
 *      per library, which owns the gate for everyone else.
 *
 * Rule severity: the shared config sets warn on introduction, because many
 * pre-existing violations must not turn every project lint red at once.
 * Promote to error once a project is clean.
 *
 * Configuration: `animationLibs` — module specifiers considered motion-capable.
 */

const DEFAULT_ANIMATION_LIBS = [
	"gsap",
	"gsap/ScrollTrigger",
	"gsap/Draggable",
	"gsap/ScrollSmoother",
	"gsap/MotionPathPlugin",
	"gsap/InertiaPlugin",
	"gsap/SplitText",
	"gsap/Observer",
	"lottie-web",
];

const RUNTIME_OWNER_TAG = "portadesign/heavy-lib-runtime-owner";
const GUARD_PATTERN = /prefers-reduced-motion/;

/**
 * True when the guard token appears in executable code, not merely in prose.
 *
 * Blanking every comment range before matching is the whole point: a docblock
 * explaining that a component "does not need a prefers-reduced-motion guard"
 * would otherwise satisfy the rule it is arguing with. Replacing each comment
 * with spaces (rather than deleting it) keeps offsets stable, which matters if
 * this ever needs to report a location inside the scanned text.
 */
function hasGuardInCode(sourceCode) {
	const text = sourceCode.getText();
	const chars = text.split("");
	for (const comment of sourceCode.getAllComments()) {
		for (let i = comment.range[0]; i < comment.range[1]; i++) chars[i] = " ";
	}
	return GUARD_PATTERN.test(chars.join(""));
}

export default {
	meta: {
		type: "problem",
		docs: {
			description:
				"Require a prefers-reduced-motion guard in files that import an animation " +
				"library directly, since a gate in the entry script covers only the shared runtime.",
		},
		schema: [
			{
				type: "object",
				properties: {
					animationLibs: {
						type: "array",
						items: { type: "string" },
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			unguarded:
				"'{{source}}' is imported directly, so the reduced-motion gate of " +
				"the shared runtime does not apply to this file — it only gates the shared " +
				"runtime. Reference `prefers-reduced-motion` here and decide what this " +
				"component does under it (freeze perpetual motion, or jump to the final " +
				"state — never simply skip, if content starts hidden). WCAG 2.3.3.",
		},
	},

	create(context) {
		const options = context.options[0] || {};
		const animationLibs = new Set(options.animationLibs || DEFAULT_ANIMATION_LIBS);
		const sourceCode = context.sourceCode;

		// Runtime owners are exempt: the canonical runtime is what everyone
		// else's gate protects, and it is loaded behind that gate already.
		const hasRuntimeOwnerTag = sourceCode
			.getAllComments()
			.filter((c) => c.loc.start.line <= 10)
			.some((c) => c.value.includes(RUNTIME_OWNER_TAG));

		// One report per file, on the first offending import — a component
		// importing gsap + ScrollTrigger + Draggable has ONE missing guard, not
		// three, and three identical messages would train the reader to skim.
		let reported = false;

		return {
			ImportDeclaration(node) {
				if (hasRuntimeOwnerTag || reported) return;
				if (!animationLibs.has(node.source.value)) return;
				// Cheap and last: only scan the text once a motion import is seen.
				if (hasGuardInCode(sourceCode)) return;
				reported = true;
				context.report({
					node,
					messageId: "unguarded",
					data: { source: node.source.value },
				});
			},
		};
	},
};
