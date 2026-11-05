# Stylelint entry point

`@parisek/test-kit/stylelint` exports the shared Stylelint config and the `portadesign` plugin rules. It serves requirement R13.40. R13.46 to R13.50 and [ADR 0006](../../docs/adr/0006-lint-entry-points.md) set the contract.

The entry point lints a project. It does not capture, compare or report. Loading it resolves two lint packages and no browser package.

## Parts

| File | Pure | Holds |
| --- | --- | --- |
| `index.cjs` | no | The entry point. It checks the required peers, then exports the config object. |
| `config.cjs` | yes | The config object: `extends`, `plugins` and `rules`. |
| `peers.cjs` | no | `assertPeers()`. It resolves the required peers and throws `LINT_PEER_MISSING` for a missing one. |
| `rules/` | yes | The five rules and the plugin list. The rule logic moved from the first consumer project. |

All files are CommonJS (`.cjs`). The package declares `"type": "module"`, so a `.js` file would load as ESM. A CommonJS entry loads with `require` and with `import`. Stylelint 17 needs Node 20.19 or later.

## Use

```js
// .stylelintrc.cjs
const testKit = require('@parisek/test-kit/stylelint');

module.exports = {
  ...testKit,
  // Project values go after the entry point (R13.48).
  ignoreFiles: ['dist/**'],
  rules: {
    ...testKit.rules,
    // Restate the whole list: Stylelint replaces an option and does not merge it.
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['root', 'deep', 'global', 'is-scrolled'] }],
    'portadesign/prefer-utility-over-apply': null,
  },
};
```

An ES module config works too: `import testKit from '@parisek/test-kit/stylelint'`.

Install the peers. Both are required. In `package.json` they are marked `"optional": true` in `peerDependenciesMeta`. That flag is for the package manager only: it stops `npm` from installing them for a project that never lints. It does not make them optional for this entry, which throws at load without them (see "Missing peers").

```bash
npm i -D stylelint stylelint-config-standard
```

## Rules

The names and the `portadesign` namespace are frozen (R13.40). A `/* stylelint-disable portadesign/<rule> */` comment works.

| Rule | Level | Reports |
| --- | --- | --- |
| `portadesign/no-duplicate-import` | error | The same `@import` source twice in one file. |
| `portadesign/no-undefined-tailwind-prose` | error | `@apply prose-<x>` with an unknown variant (option `allow`). |
| `portadesign/prefer-utility-over-apply` | warning | A plain class made only of `@apply` rules. Use `@utility`. |
| `portadesign/import-order` | error | Top-level at-rules out of the canonical order. |
| `portadesign/no-length-division` | warning | A length divided by a length inside a CSS math function. Firefox rejects it. |

The rule files keep the source style of the project they came from (tabs and double quotes). They set no `meta.url`, because the old URL pointed at a private repository.

## Missing peers (R13.47)

`stylelint` and `stylelint-config-standard` are required. If Node cannot resolve one, loading the entry throws `LintPeerError` with the code `LINT_PEER_MISSING`. The message names the package and the install command.

## What is not here

- No custom pseudo-classes beyond `root`, `deep` and `global`, and no `ignoreFiles` (R13.48). The project adds them.
- No baseline file (R13.49). The package writes nothing.
- No change to the `packs/lint` pack. That pack runs the project's linters and reads their output (`src/packs/lint/README.md`).

## Tests

`tests/unit/stylelint-entry.test.js` is pure and needs no package: it covers `assertPeers` and `LINT_PEER_MISSING`. The tests that lint CSS sit in `tests/lint-cases/`: `stylelint-rules.mjs` runs each rule through `stylelint.lint`, and `stylelint-entry.mjs` covers `require` and `import`, the project override, the disable comment, the missing `stylelint` in a child process, and a child process that checks that no browser package loads. `npm test` loads them only when the peers are installed. Without them the run prints a skip with the reason. CI sets `TEST_KIT_REQUIRE_LINT_PEERS=1` after `npm ci`, so a missing peer there fails the run.
