/**
 * portadesign/no-deprecated-dependency
 *
 * Disallow imports of packages the project has retired by doctrine. Each
 * entry carries a migration message pointing at the replacement.
 *
 * Tippy.js was retired in favor of native `<dialog>` / `popover` /
 * `@alpinejs/ui` / `@floating-ui/dom`.
 * jQuery is retired in favor of vanilla DOM + Alpine.
 *
 * The deprecation list is configurable per project:
 *   "portadesign/no-deprecated-dependency": ["error", {
 *     deprecated: { "tippy.js": "use @floating-ui/dom" }
 *   }]
 *
 * Severity: error. A disable comment is reserved for a single line during
 * migration, with the reason referencing the migration ticket.
 *
 * Cross-tool note: this catches the IMPORT only. Removing the import but
 * leaving the package in `dependencies` still ships the bundle (tree-shaking
 * is opportunistic). A complementary `package.json` check
 * verifies the dependency entry is also gone.
 */

const DEFAULT_DEPRECATED = {
	"tippy.js":
		"Tippy.js is archived. Use @floating-ui/dom + an x-tooltip directive.",
	jquery:
		"jQuery is retired. Use vanilla DOM + Alpine directives.",
};

export default {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow imports of dependencies the project has retired by doctrine.",
		},
		schema: [
			{
				type: "object",
				properties: {
					deprecated: {
						type: "object",
						additionalProperties: { type: "string" },
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			deprecated: "Dependency '{{source}}' is retired. {{reason}}",
		},
	},

	create(context) {
		const options = context.options[0] || {};
		const deprecated = options.deprecated || DEFAULT_DEPRECATED;

		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				if (Object.prototype.hasOwnProperty.call(deprecated, source)) {
					context.report({
						node,
						messageId: "deprecated",
						data: { source, reason: deprecated[source] },
					});
				}
			},
		};
	},
};
