# ADR 0006: ESLint and Stylelint entry points

Status: accepted by the owner in chat on 2026-10-25 (decision 1) and on 2026-11-04 (decisions 2 to 6). Issue #26 holds both comments.
Requirements: R13.40, R13.43, R13.46 to R13.50, R5.1, R4.4, R12.4. Principles: 5, 6. Tier 2 (the choices below keep every principle). The new peer dependencies are optional and the owner approved them.

## Context

R13.40 decides that the package ships the `portadesign` ESLint and Stylelint rules as two entry points. This record decides how. The first consumer project holds the rules today. A read-only pass over that project on 2026-10-25 found:

- ESLint: 4 rules, one shared flat config, 11 fixtures, 17 files.
- Stylelint: 5 rules, one shared config that extends `stylelint-config-standard`, 7 fixtures, 14 files.
- The project imports the shared config and adds overrides after it. This is the shape of R13.40.
- No lint baseline file exists. Two disable comments in project code name core rule IDs. None names a `portadesign/*` rule.

The entry points need nine packages: `eslint`, `@eslint/js`, `eslint-plugin-import`, `eslint-plugin-vue`, `vue-eslint-parser`, `globals`, `typescript-eslint`, `stylelint` and `stylelint-config-standard`. The package has none of them. Its runtime dependencies are `pixelmatch` and `pngjs`. Its optional peers are `@playwright/test`, `axe-core` and `lighthouse`.

## Decision

1. **Optional peer dependencies** (owner, 2026-10-25). Every package above is a peer dependency with `peerDependenciesMeta.<name>.optional: true`. The project keeps one ESLint and one Stylelint instance. A user who only captures screenshots installs nothing new. The pattern is the one the three existing optional peers use.
2. **Ranges follow the majors that the first consumer project uses** (owner, 2026-11-04). The ranges are in the table below. Newer majors exist for `eslint` (10), `@eslint/js` (10) and `stylelint` (18), and `stylelint-config-standard` (41). The package does not claim them. A later pull request widens a range after a test run on that major.
3. **Missing peers.** A peer is either required for the entry point or an optional enhancement of it.
   - Required for ESLint: `@eslint/js`, `eslint-plugin-import`. Required for Stylelint: `stylelint`, `stylelint-config-standard`. A missing one throws `LINT_PEER_MISSING` when the project imports the entry point. The message names the package and the install command. No stack trace of `ERR_MODULE_NOT_FOUND` reaches the user.
   - Optional enhancement: `typescript-eslint` (TypeScript parsing), `globals` (browser and Node global lists), and the pair `eslint-plugin-vue` with `vue-eslint-parser` (Vue single-file components). A missing one drops its config block and prints one warning that names the package and the effect. The entry point never drops coverage in silence.
   - `eslint` itself is not imported by the entry points. The project's ESLint loads the array.
4. **Project values are project input** (owner, 2026-11-04). The shared config holds no vendor globals, no custom pseudo-classes and no ignore paths. A project adds them after the entry point, in its own config file (R13.40). Flat config merges `languageOptions.globals` across blocks, so a project block adds globals without restating the shared ones. A project that overrides `selector-pseudo-class-no-unknown` states the whole list, because Stylelint replaces an option instead of merging it.
5. **"Baselines" means disable comments and overrides** (owner, 2026-11-04). A `portadesign/...` disable comment and a project override after the entry point keep working. The package adds no baseline file. Rule IDs and the namespace stay frozen (R13.40).
6. **`eslint` and `stylelint` are devDependencies** (owner, 2026-11-04). `node --test` runs the rules with `RuleTester` and `stylelint.lint`. The other peers are devDependencies too, because the entry-point tests load them. This matches the three existing optional peers, which are devDependencies already.

Layout (design detail, Tier 1): `src/eslint/` and `src/stylelint/`. Each folder holds a README, the rules and the entry file. Fixtures sit in `tests/fixtures/lint/`.

The Stylelint entry is a CommonJS file (`index.cjs`). The package is `"type": "module"`, so a `.js` file would load as ESM. The moved Stylelint rules are CommonJS and call `require("stylelint")`. A `.cjs` entry loads the same way from `require` and from `import`. A project config such as `.stylelintrc.cjs` calls `require`. Stylelint 17 needs Node 20.19 or later, and `require()` of an ES module works from that version, so the choice does not depend on the Node version. The ESLint entry is an ES module, because flat config projects use `import` and the entry loads optional peers with `await import()`.

## Ranges and security check

Checked on 2026-11-05. OSV is `https://api.osv.dev/v1/query` with ecosystem `npm`. GHSA is `https://api.github.com/advisories?ecosystem=npm&affects=<package>`. "Last release" is `npm view <package> time.modified`. Every repository is the original project. `fork` is `false` in the GitHub API for each one, and none is archived.

| Package | Range | Latest | Last release | OSV | GitHub advisories | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `eslint` | `^9.39.5` | 10.14.0 | 2026-10-30 | 0 | 2 old (see note 1) | `eslint/eslint` |
| `@eslint/js` | `^9.39.5` | 10.0.1 | 2026-07-10 | 0 | 0 | `eslint/eslint` |
| `eslint-plugin-import` | `^2.32.0` | 2.32.0 | 2025-06-20 | 0 | 0 | `import-js/eslint-plugin-import` |
| `eslint-plugin-vue` | `^10.11.0` | 10.12.0 | 2026-10-26 | 0 | 0 | `vuejs/eslint-plugin-vue` |
| `vue-eslint-parser` | `^10.4.1` | 10.4.1 | 2026-06-02 | 0 | 0 | `vuejs/vue-eslint-parser` |
| `globals` | `^17.12.0` | 17.14.0 | 2026-11-01 | 0 | 0 | `sindresorhus/globals` |
| `typescript-eslint` | `^8.70.0` | 8.72.1 | 2026-11-02 | 0 | 0 | `typescript-eslint/typescript-eslint` |
| `stylelint` | `^17.15.0` | 18.0.0 | 2026-11-03 | 0 | 1 old (see note 2) | `stylelint/stylelint` |
| `stylelint-config-standard` | `^40.0.0` | 41.0.0 | 2026-11-03 | 0 | 0 | `stylelint/stylelint-config-standard` |

1. `eslint`: GHSA-p5wg-g6qr-c7cg is withdrawn (affected `< 9.26.0`). GHSA-jcgq-xh2f-2hfm affects `< 4.18.2`. The ranges above are outside both.
2. `stylelint`: GHSA-f7xj-rg7h-mc87 (low, a `semver` dependency) affects `>= 8.0.0, < 15.10.1`. The range is outside it.

`eslint-plugin-import` has the oldest release (June 2025) and declares `eslint` up to `^9` only. It is the one maintenance risk. The shared config uses two of its rules (`import/no-duplicates`, `import/no-self-import`). A later record can replace them if the plugin stalls. `typescript-eslint` needs `typescript` (`>=4.8.4 <6.1.0`). The project that lints TypeScript already has it. The package does not list `typescript` as a peer.

The check covers known advisories on the day above. It does not cover a future one. Dependabot or `npm audit` in the consumer project watches the installed versions.

## Alternatives rejected

- **Hard dependencies.** They give the project a second ESLint or Stylelint instance and install nine packages for a screenshot user. The owner chose optional peers.
- **A `createConfig(options)` factory for globals and ignores.** A project already adds blocks after the array (R13.40). A factory would add a second public API to freeze. Rejected for now. It is an addition if a need appears.
- **Keep the vendor globals, pseudo-classes and ignore paths in the shared config.** They are values of one project and would leak to the next one. The owner decided to make them project input.
- **An ES module entry for Stylelint.** It would force a rewrite of the moved rules or a mix of two module kinds in one folder. The `.cjs` entry keeps the rules as they are.
- **A baseline file written by the package.** No such file exists today and nothing needs it. R5.1 and principle 5 say a new artifact must be opt-in.

## Consequences

- R13.46 to R13.50 record the contract. `docs/seam.md` gains two rows (additions, not breaks).
- The work is two pull requests: the ESLint entry, then the Stylelint entry. The project switch to the thin import waits for the skeleton adoption issue (#21) and stays in the project (R13.43).
- Rule logic moves from the first consumer project. No client name, URL or path moves with it (R12.4). Project documentation links in rule messages are removed.
- Fixtures are rewritten with `example-site` style names where needed.
