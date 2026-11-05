// Pure. The shared Stylelint config as a plain object (R13.40, R13.48).
// It holds no project value: no custom pseudo-classes beyond the generic ones, no ignore paths.
// A project spreads it into its own config and adds its values (see README.md).
const plugins = require('./rules/index.cjs');

// Tailwind v4 at-rules. Two rules share the list, so they cannot drift apart: an at-rule added
// to one and forgotten in the other would report on every use.
const TAILWIND_AT_RULES = [
  'theme', 'utility', 'source', 'config', 'plugin', 'apply', 'variant', 'custom-variant',
  'custom-media', 'variants', 'screen', 'layer', 'tailwind', 'reference',
];

module.exports = {
  extends: ['stylelint-config-standard'],
  plugins,

  rules: {
    // `at-rule-prelude-no-invalid` is on in stylelint-config-standard 40 and later. It parses a
    // prelude as CSS grammar, and `@apply text-sm font-bold` is a list of utility classes, so
    // without this every `@apply` is reported. The exemption is narrow: a broken
    // `@container (((broken` prelude is still reported.
    'at-rule-prelude-no-invalid': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
    'at-rule-no-unknown': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
    // No custom pseudo-classes (R13.48). A project adds framework ones (`deep`, `global`) and its
    // own state classes by restating this rule with the full list, because Stylelint replaces an
    // option and does not merge it.
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['root'] }],

    // `@custom-variant` bodies use a bare `&` scoping selector. It is not standard CSS nesting,
    // so stylelint-config-standard 40 misreads it as an orphaned nesting selector.
    'nesting-selector-no-missing-scoping-root': null,

    'no-duplicate-selectors': true,
    'selector-no-invalid': true,
    'no-empty-source': null, // partials are legitimately stubs
    'no-descending-specificity': null, // utility-first cascades trip this constantly
    'no-duplicate-at-import-rules': null, // replaced by portadesign/no-duplicate-import
    'import-notation': null, // both `@import "x"` and `@import url("x")` are accepted
    'no-invalid-position-at-import-rule': null, // Tailwind v4 with cascade layers emits @import after @layer

    // Formatting only. The `*-empty-line-before` family fights intentionally tight code.
    'rule-empty-line-before': null,
    'at-rule-empty-line-before': null,
    'comment-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'declaration-empty-line-before': null,

    'selector-class-pattern': null, // Tailwind classes break the standard pattern

    // Tailwind v4 paired tokens: `--text-foo--line-height` rides on the same utility as
    // `--text-foo`. Allow at most one paired suffix. Stylelint strips the leading `--` before
    // it matches.
    'custom-property-pattern': [
      '^([a-z][a-z0-9]*)(-[a-z0-9]+)*(--[a-z][a-z0-9]*(-[a-z0-9]+)*)?$',
      {
        message: (name) => `Expected custom property "${name}" to be kebab-case, optionally with one Tailwind v4 paired-token suffix (for example --text-foo--line-height).`,
      },
    ],
    'function-no-unknown': [true, { ignoreFunctions: ['theme', 'var'] }],

    'portadesign/no-duplicate-import': true,
    'portadesign/no-undefined-tailwind-prose': true,
    'portadesign/prefer-utility-over-apply': true,
    'portadesign/import-order': true,
    // A warning, not an error: a project with old violations must not turn red at once.
    // Promote to error when the project is clean.
    'portadesign/no-length-division': [true, { severity: 'warning' }],
  },
};
