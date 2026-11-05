# ESLint entry point

`@parisek/test-kit/eslint` exports the shared ESLint flat config and the `portadesign` plugin. It serves requirement R13.40. R13.46 to R13.49 and [ADR 0006](../../docs/adr/0006-lint-entry-points.md) set the contract.

The entry point lints a project. It does not capture, compare or report. Importing it loads no browser package.

## Parts

| File | Pure | Holds |
| --- | --- | --- |
| `index.js` | no | The entry point. It loads the peers, prints warnings, and default-exports the config array. It also exports `plugin` and `LintPeerError`. |
| `config.js` | yes | `buildConfig(peers)`. It builds the flat-config array from loaded peers. |
| `peers.js` | no (through the importer) | `loadPeers(importer)`. It loads the peers and decides what a missing one means. |
| `rules/` | yes | The four rules and the plugin object. The rule logic moved from the first consumer project. |

## Use

```js
// eslint.config.js
import testKit from '@parisek/test-kit/eslint';

export default [
  ...testKit,
  // Project values go after the entry point (R13.48).
  { languageOptions: { globals: { gsap: 'readonly' } } },
  { ignores: ['dist/**'] },
  { rules: { 'portadesign/require-reduced-motion-guard': 'error' } },
];
```

Install the peers. In `package.json` every one is marked `"optional": true` in `peerDependenciesMeta`. That flag is for the package manager only: it stops `npm` from installing or warning about a peer that a screenshot-only project never needs. It does not make a peer optional for this entry point. `@eslint/js` and `eslint-plugin-import` are required here, and the import fails at runtime without them (see "Missing peers").

```bash
npm i -D eslint @eslint/js eslint-plugin-import                                           # required
npm i -D globals typescript-eslint typescript eslint-plugin-vue vue-eslint-parser   # enhancements
```

## Rules

The names and the `portadesign` namespace are frozen (R13.40). A `// eslint-disable-next-line portadesign/<rule>` comment works.

| Rule | Level | Reports |
| --- | --- | --- |
| `portadesign/no-top-level-heavy-lib-import` | error | A top-level import of a heavy library (option `heavyLibs`). |
| `portadesign/no-deprecated-dependency` | error | An import of a retired package (option `deprecated`). |
| `portadesign/no-top-level-throw` | error | A `throw` at module top level, outside `try` and functions. |
| `portadesign/require-reduced-motion-guard` | warn | A direct animation-library import in a file with no `prefers-reduced-motion` in code (option `animationLibs`). |

The rule files keep the source style of the project they came from (tabs and double quotes). A rule message holds no link to project documentation.

## Missing peers (R13.47)

| Peer | Missing means |
| --- | --- |
| `@eslint/js`, `eslint-plugin-import` | The import throws `LintPeerError` with the code `LINT_PEER_MISSING`. The message names the package and the install command. |
| `globals` | A warning. The browser and Node global lists are dropped, and `no-undef` is off. |
| `typescript-eslint` | A warning. TypeScript files and script blocks with `lang="ts"` are not linted. |
| `eslint-plugin-vue` or `vue-eslint-parser` | A warning. Vue files are not linted. Both are needed. |

`eslint` itself is a peer of the project. The entry point does not import it.

## What is not here

- No vendor globals, no ignore paths, no project paths (R13.48). The project adds them.
- No baseline file (R13.49). The package writes nothing.
- No change to the `packs/lint` pack. That pack runs the project's linters and reads their output (`src/packs/lint/README.md`).

## Tests

`tests/unit/eslint-entry.test.js` is pure and needs no package: it covers `messageIds`, the blocks that `buildConfig` drops, and `loadPeers`. The tests that lint code sit in `tests/lint-cases/` (`eslint-rules.mjs` with `RuleTester`, `eslint-entry.mjs` for the namespace, the project override, the disable comment, and the import in a child process that blocks the browser packages). `npm test` loads them only when the peers are installed. Without them the run prints a skip with the reason, so `npm test` needs no dependency. After `npm ci` they run. CI sets `TEST_KIT_REQUIRE_LINT_PEERS=1`, so a missing peer there fails the run.
