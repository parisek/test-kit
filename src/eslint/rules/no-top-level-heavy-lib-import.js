/**
 * portadesign/no-top-level-heavy-lib-import
 *
 * Disallow top-level `import` of heavy libraries from per-component JS files.
 * Heavy libs (GSAP, LightGallery, Lottie, Vue, Floating UI, …) must be
 * lazy-imported on first DOM presence:
 *
 *   if (document.querySelector(".component-foo")) {
 *     import("gsap").then(({ default: gsap }) => { ... });
 *   }
 *
 * Top-level `import gsap from "gsap"` pulls the library into every page
 * that loads the file, defeating the lazy-load contract and
 * breaking the single-runtime invariant for GSAP (parallel instances vs.
 * one canonical runtime module that exposes window.gsap).
 *
 * Opt-in for canonical runtime owners: a file with the comment
 *   // portadesign/heavy-lib-runtime-owner
 * in its top 10 lines is allowed to import heavy libs synchronously.
 * Reserved for the single canonical entry per library.
 *
 * Rule severity: error (the violation is binary — either lazy-imported or not).
 *
 * Configuration: rule accepts an options object with `heavyLibs` — a list
 * of module specifiers to forbid. Defaults to the project-wide seed list.
 * Project-local override:
 *   "portadesign/no-top-level-heavy-lib-import": ["error", { heavyLibs: [...] }]
 */

const DEFAULT_HEAVY_LIBS = [
	"gsap",
	"gsap/ScrollTrigger",
	"gsap/Draggable",
	"gsap/ScrollSmoother",
	"gsap/MotionPathPlugin",
	"lightgallery",
	"lightgallery/plugins/zoom",
	"lightgallery/plugins/thumbnail",
	"lightgallery/plugins/video",
	"lottie-web",
	"vue",
	"pinia",
	"vue-google-maps-community-fork",
	"@floating-ui/dom",
	"tippy.js",
];

const RUNTIME_OWNER_TAG = "portadesign/heavy-lib-runtime-owner";

// Framework packages: structural dependencies of a Vue island rather than
// optional features, so they cannot be deferred from within one.
const FRAMEWORK_SPECIFIERS = new Set(["vue", "pinia"]);

// An island is anything the component/page auto-loader reaches: the entry
// module `templates/<kind>/<name>/js/<name>.{js,ts}`, its `js/lib/` helpers,
// and the SFCs beside them. Matched anywhere in the path so it holds for
// absolute paths and for any docroot layout (wp-content/…, web/themes/…).
const ISLAND_PATH = /[\\/]templates[\\/](?:component|page)[\\/][^\\/]+[\\/]js[\\/]/;

const isInsideIsland = (filename) => {
	if (!filename) return false;
	return filename.endsWith(".vue") || ISLAND_PATH.test(filename);
};

export default {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow top-level imports of heavy libraries; lazy-import on first DOM presence.",
		},
		schema: [
			{
				type: "object",
				properties: {
					heavyLibs: {
						type: "array",
						items: { type: "string" },
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			topLevel:
				"Heavy library '{{source}}' must be lazy-imported on first DOM presence. " +
				"Use `if (document.querySelector(...)) { import('{{source}}').then(...) }`.",
		},
	},

	create(context) {
		const options = context.options[0] || {};
		const heavyLibs = new Set(options.heavyLibs || DEFAULT_HEAVY_LIBS);

		// Detect runtime-owner opt-in by scanning the first 10 lines for the tag.
		const sourceCode = context.sourceCode;
		const head = sourceCode
			.getAllComments()
			.filter((c) => c.loc.start.line <= 10);
		const hasRuntimeOwnerTag = head.some((c) => c.value.includes(RUNTIME_OWNER_TAG));

		return {
			ImportDeclaration(node) {
				if (hasRuntimeOwnerTag) return;

				// Only flag top-level imports (inside Program node, not inside a function).
				if (node.parent && node.parent.type !== "Program") return;

				// A type-only import is erased at compile time — it emits no
				// require/import and so cannot cost a byte at runtime, which is
				// the entire thing this rule protects. `import type { Ref } from
				// "vue"` is the idiomatic way to type a composable and must not
				// be pushed into a lazy import(); types cannot be imported
				// dynamically at all. Only reachable since TS began being linted.
				if (node.importKind === "type") return;

				// Inline type specifiers are the same thing spelled differently:
				// `import { type Ref } from "vue"` leaves the DECLARATION's
				// importKind as "value" — only the individual specifiers carry
				// "type". If every specifier is a type, nothing is imported at
				// runtime and there is no cost for this rule to protect.
				// `node.specifiers.length` is checked because a side-effect
				// import (`import "vue"`) has none, and `[].every()` is true.
				if (
					node.specifiers.length > 0
					&& node.specifiers.every((spec) => spec.importKind === "type")
				) return;

				// A UI framework imported from INSIDE its own island is not a
				// finding. The auto-loader imports `component/<n>/js/<n>.js`
				// DYNAMICALLY, and only when the component's selector matches
				// the page — so everything the island pulls in is already
				// behind that gate. The remedy this rule prints ("wrap it in
				// `if (querySelector) import()`") is impossible there: you
				// cannot lazy-import Vue from within a Vue component. Flagging
				// it produces errors nobody can fix — a first consumer project
				// measured 46 of them in 2026-07, all `vue`/`pinia`.
				//
				// The boundary is the bundle, not the file extension. In a
				// main-bundle script the same import IS the bug this rule exists
				// for: an eager `vue` there is paid by every page of the site.
				// The same project measured 29 findings, all inside islands and
				// none in the main bundle. An ENTRY module of an island keeps
				// the RUNTIME_OWNER_TAG escape hatch.
				if (
					FRAMEWORK_SPECIFIERS.has(node.source.value)
					&& isInsideIsland(context.filename)
				) return;

				const source = node.source.value;
				if (heavyLibs.has(source)) {
					context.report({
						node,
						messageId: "topLevel",
						data: { source },
					});
				}
			},
		};
	},
};
