# The project seam

Status: confirmed by the owner on 2026-10-25 (issue #105). Four decisions are recorded (marked "decided"). It serves vision open decision 9 and issue #105. It cites R13.9, R13.25 to R13.27, R13.40, R13.41 and R13.43.
The owner confirmed the list in chat on 2026-10-25. A marking below is the agent's reading of the code on 2026-10-19 (`package.json` version 0.5.0 at that time; the candidate sets 1.0.0; `main` at 245611d). Rows that describe the `packs` key (R13.44) read `main` at dcea71a. The owner decided four points on 2026-10-19: `init` does not exist, the axe `incomplete` rule (R8.14), `basis` waits for `schemaVersion` 3, and the freeze scope of the packs. They are marked "decided" below.

The seam is everything a project touches: its configuration file, the commands it calls, the contract and pack API it imports, the data it stores, and the files it copies.

## The freeze rule

- Before the first release candidate tag (`vX.Y.Z-rc.1`, R13.45), a break of any item costs nothing. The package is alpha (vision, Maturity; R13.9). A break needs a changelog entry and a migration note.
- From the first release candidate tag, the freeze starts. A change to a frozen item needs a new major version and a migration note. An addition that old input still passes is not a change.
- The major-version consequence is a proposal. Vision open decision 9 says only "freeze". The form of the release candidate tag is decided: `vMAJOR.MINOR.PATCH-rc.N` (R13.45, owner decision, 2026-10-19). Only the owner tags it.
- A project pins an exact tag until 1.0 (R13.27). The lockfile pins the commit. A break reaches a project only when it updates the pin.
- Only the owner approves and tags a stable release (R13.25, R13.26). This document names no tag and no date. Only the owner tags a release candidate (R13.45). The tags `v1.0.0-rc.1` to `v1.0.0-rc.7`, the stable tag `v1.0.0` (2026-11-04) and the tag `v1.1.0-rc.1` (2026-11-05) exist.
- The word "freeze" does not extend to anything marked "not frozen". Those items may still change in a minor version.
- Two exceptions exist. Each sets no precedent for another frozen item.
  - The owner allowed the narrowing of `engines.node` to `>=20.19` in the minor release 1.1.0, with a migration note, on 2026-11-06 (#298). See "Runtime requirement".
  - The owner allowed the move of the default store from `.test-kit` to `test-kit`, and of the `runsRoot` default from `.test-kit/runs` to `test-kit/runs`, in the minor release 1.2.0, with a migration note, on 2026-11-06 (#312). See the `runsRoot` row in section 2 and the store note in section 3. An explicit `--store` keeps the old store for `run`, `before`, `after`, `report`, `history` and project `perf` (`--store .test-kit`). An explicit `runsRoot` keeps working for `capture`, `import`, `diff` and plain `perf`. The old `.test-kit/` is not read, moved or deleted. A project deletes it by hand. Old baselines are not carried over. A project that keeps the old store with `--store .test-kit` must also set `"runsRoot": ".test-kit/runs"`, or `capture`, `diff` and plain `perf` use `test-kit/runs` and the stores split.
  - Round 3 (owner decision on #312, 2026-11-06) adds four behaviours to frozen commands: (a) the store `.gitignore` with `*` is also written by `capture`, `import` and plain `perf` when they use the default `runsRoot`. A project with an unrelated `test-kit/` folder must rename it, or pass `--store`, before it upgrades, or new files there become ignored; (b) `run`, `before`, `after`, `report`, `history`, `perf`, `capture`, `import` and `diff` print one stderr line when they find an old `.test-kit/` beside the configuration, only when the default store or the default `runsRoot` is in use (`--store` or a configured `runsRoot` suppresses it); (c) `after` stops early with "Run before again" when the baseline is missing; (d) the runtime copy of the configuration lives in the store. The same decision extends the viewer refresh to `capture`, `import` and plain `perf` when they write the default store, and keeps exports under `test-kit/export/`. The frozen commands `capture`, `import`, `diff`, `perf` and `history` gain these behaviours once. `diff` gains the legacy notice only. This sets no precedent (#312).

## Markings

| Marking | Meaning |
| --- | --- |
| Frozen | The release candidate fixes it. Source and requirement are named. |
| Experimental | It ships and works. The name or shape may change in a minor version. |
| Not frozen, owner decision open | The specification or the vision calls it open. The agent does not decide it. |
| Not frozen, change planned | A planned change (`schemaVersion` 3) replaces it. |
| Frozen (decided) | The owner decided the freeze. Same effect as Frozen. |
| Not frozen (decided) | The owner decided it stays unfrozen and may change in a minor version. |
| Does not exist (decided) | The owner decided the package does not build it. |
| Deferred (decided) | The owner decided to wait for a named later version. |

## 1. Configuration file

Source of truth: `src/config/normalize.js` (`normalizeConfig`), read by `src/config/index.js` (`loadConfig`). The file is JSON only (`JSON.parse`). The default path is `test-kit.config.json` in the working directory. Runtime paths resolve from the directory of the file. The prose is in `src/config/README.md` and `docs/contracts.md`.

The sketch in specification section 5 (`targets: { source: ... }`, `budgets`) is not the shipped shape. The code rejects `budgets`, `allowlist`, `lint` and `a11y` as unsupported keys (measured on v0.5.0 and on `main` at 245611d, 2026-10-19). The `packs` key was rejected then. `main` at dcea71a accepts it (R13.44). Any other unknown key at any level also fails.

Marking of the file as a whole: frozen for the keys in the table, with `schemaVersion: 1`. A new optional key is an addition. A new required key or a removed key is a break. The defaults and the values of the check IDs are not frozen (see the rows below).

| Key | Type | Default | Required | Notes |
| --- | --- | --- | --- | --- |
| `schemaVersion` | number | none | yes | Must be `1`. |
| `sides` | object | none | yes | 1 to 20 entries. A key is a safe ID (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`). |
| `sides.<id>.origin` | string | none | yes, for a browser side | An HTTP origin with no path or credentials. Local unless `remote` is `true`. A design side has none (the next row). |
| `sides.<id>.kind`, `provider`, `root` | string, string, string | none | no | R5.5. `kind: "design"` makes a side of images: `provider` is `files` (with `root`, a plain relative directory) or `figma` (with `fileKey`, no `root`). It takes no other key and has no origin. The token has no key: it is the environment variable `FIGMA_TOKEN`. Not in the capture settings hash. An addition: old input passes. Added after 1.1.0. The owner confirmed it on 2026-11-06 (#288). |
| `sides.<id>.remote` | boolean | `false` | no | R3.3. Added in 0.5.0. |
| `sides.<id>.userAgent` | string | the Playwright default | no | R3.4. Only with `remote: true`. 1 to 512 printable ASCII characters. Not in the capture settings hash. Added in 1.0.0-rc.6. |
| `sides.<id>.challenge` | string | none | no | R3.5. Only with `remote: true`. The one value is `"cloudflare"`. Not in the capture settings hash. Added in 1.0.0-rc.7. |
| `sides.<id>.allowOrigins` | array | none | no | R3.9. Local or remote side. 1 to 20 entries `{origin, types}`: an HTTPS origin (no path, credentials or wildcard) and 1 or 2 of `stylesheet`, `font`. GET and HEAD only, never a navigation. In the capture settings hash when it is not empty. Added in 1.1. |
| `sides.<id>.thirdParty` | `"block"` or `"drop"` | local `block`, remote `drop` | no | R3.10. Local or remote side. `drop` aborts a GET or HEAD frame or subresource of another origin and keeps the capture. `block` fails the capture. A top-level navigation and every non-read method still fail. In the capture settings hash when set. Added in 1.1. |
| `sides.<id>.production` | boolean | `false` | no | R6.5. `perf` on this side waits for `--consent` for any number of targets. The side id does not decide. Added in 1.0.0-rc.4. |
| `sides.<id>.settle` | object | see below | no | Settle recipe (R5.4). |
| `targets` | list | none | yes | 1 to 1000 entries. |
| `targets[].id` | string | none | yes | Safe ID. Unique. |
| `targets[].kind` | string | none | yes | `page` or `component`. |
| `targets[].title` | string | the `id` | no | |
| `targets[].path` | string | none | one of | Origin-relative path. Every side needs `path` or a `paths` entry. |
| `targets[].paths` | object | none | one of | Path for each side ID. |
| `targets[].design` | object | none | no | R5.5. Viewport ID to a PNG path under the `root` of a design side. Needs a design side. A design side needs no target path. Not in the capture settings hash. An addition. The owner confirmed it on 2026-11-06 (#288). |
| `targets[].selector` | string or list | none | no | CSS selector, or 1 to 50 unique selectors. |
| `targets[].box` | string | none | no | `border` or `content`. Needs `selector`. |
| `targets[].settle`, `targets[].settleBySide` | object | none | no | Partial settle recipe, for all sides or for one side. |
| `targets[].layout` | object | none | no | R6.14. `{ parts: [ { id, selector, repeat? } ] }`, 1 to 50 parts with unique safe IDs. Read only when the run selects the `layout` artifact. Not in the capture settings hash. An addition: old input passes (owner direction, 2026-11-08, #350). |
| `targetSource` | object | none | no | R13.3. Component targets from a styleguide side. Needs `source: "styleguide"` and `side`. Optional `mount` (default `/styleguide`), `include` (target IDs) and the booleans `variants` and `pages` (R13.52, default off). `targets` must be absent or empty. Not in the capture settings hash. An addition: old input passes. Added after 1.0.0. |
| `viewports` | list | none | yes | 1 to 20 entries. |
| `viewports[].id`, `width`, `height` | string, number, number | none | yes | Width and height 1 to 4096. At most 32 million physical pixels. |
| `viewports[].deviceScaleFactor` | number | `1` | no | 0.5 to 3. |
| `artifacts` | list | `["screenshot"]` | no | 1 to 6 of `screenshot`, `html`, `status`, `content`, `behavior`, `layout`. Additive only. `layout` and the cap of 6 (was 5) are an addition: every old list still passes (R6.14, #350). |
| `layout` | object | none | no | R6.15. `{ aliases? }`: a token name of side A to a token name of side B, at most 500 entries. Comparison policy only. Not in the capture settings hash. An addition (#350). |
| `checks` | list | `[]` | no | At most 6 built-in content check IDs. Needs the `content` artifact. |
| `packs` | list | `[]` | no | Built-in pack IDs: `a11y`, `lint`, `swiper`. No duplicates. No options. Nothing runs when the key is absent (R13.44, R5.1). Added after 0.5.0. |
| `runsRoot` | string | `test-kit/runs` | no | Plain relative path. The default was `.test-kit/runs` before 1.2.0 (one-time exception to the freeze rule, #312) and `tests/visual/runs` before 1.0.0 (R12.1). See section 8, gap 6. |
| `screenshot.timeoutMs` | number | `30000` | no | 1 to 120000. |
| `screenshot.fullPage` | boolean | `true` | no | |
| `rules` | object | `{}` | no | Evidenced normaliser rules (R8.4, R8.5). Shape in `src/rules/model.js`. |
| `known_diffs` | object | `{}` | no | Keyed by pair hash (R5.2). Written by `record-known` (R5.3). |
| `content.expectedLanguage` | string | none | no | For the `lang` check. |
| `behavior.source` | string | none | with `behavior` artifact | Trusted contract directory. Plain relative path. |
| `behavior.lockfile` | string | `package-lock.json` | no | |
| `behavior.projects` | object | `{}` | no | Viewport ID to Playwright project name. |
| `behavior.timeoutMs` | number | `10000` | no | 1 to 120000. |
| `behavior.maxInstances` | number | `20` | no | 1 to 100. |
| `behavior.trace` | boolean | `false` | no | |
| `behavior.emulate` | object | `{}` | no | `reducedMotion`, `colorScheme`. |
| `behavior.enabled` | list | all contracts | no | Contract names. Added in 0.3.0. An empty list selects none. |
| `sides.<id>.settle` fields | | `waitMs` 0, `selectors` `[]`, `disableMotion` `true`, `masks` `[]` | no | Optional `reveal` (list of `click`, `hover` or `focus` steps), `lazyImages` (boolean) and `pin` (list of at most 20 selectors, R5.12). |

Items inside the configuration that stay open:

| Item | Marking | Reason |
| --- | --- | --- |
| The default set of `artifacts` and `checks` | Decided by the owner on 2026-10-22 | Specification section 17, item 2. The defaults are `["screenshot"]` and `[]`. No check runs by default (R5.1). |
| Options for a selected pack | Not built before 1.0, decided by the owner on 2026-11-03 | Specification section 17, item 9. The `packs` key takes IDs only (R13.44). The pack API has no options. |
| The ESLint and Stylelint seam | Decided by the owner on 2026-10-22, 2026-11-04 and 2026-11-05; both entries are built | Specification section 17, items 7 and 10, R13.40, R13.46 to R13.50: `@parisek/test-kit/eslint` (flat-config array) and `@parisek/test-kit/stylelint` (config object) with a thin import (#105). The design is ADR 0006. The build is #26, milestone 1.1. |
| The allowlist (`reason`, `owner`) | Not frozen, decided 2026-11-06 | The file `test-kit.allowlist.json` beside the config, with no config key (R9.12, ADR 0004, open question 4). |
| Selection of checks or contracts per target | Not frozen, decided 2026-11-04 | `scope.checks` on each artifact index, derived from the run settings (ADR 0004, open question 2; R9.10). |
| Artifact kinds `a11y` and `lint` in `artifacts` | Not frozen, change planned | Both are glossary artifacts (specification section 2). The code rejects both today. They come with `schemaVersion` 3 in 1.1 (specification section 17, item 8). |
| `known_diffs` record contents | Frozen as a key, with a caveat | Each record binds `rawA`, `rawB`, `bindingHash` and `policyHash` (`src/rules/model.js`). A change to the comparator policy makes stored records stale with no schema change. A migration note must name any such change. |
| `rules` operation kinds | Experimental | Only `literal-pair` exists (`src/rules/model.js`). |

## 2. Template files

Source of truth: `templates/` and the `files` list in `package.json` (it ships `templates`). A project copies these files by hand.

| File | Marking | Reason |
| --- | --- | --- |
| `templates/test-kit.config.json` | Frozen as a valid minimal example | It passes `normalizeConfig` (measured on v0.5.0 and on `main`, 2026-10-19). A project copies it by hand. |
| `templates/test-kit.config.yaml` | Not frozen, planning sketch | Its own header says "Planned configuration sketch". The loader reads JSON only. It uses `budgets` and `targets.source`, which the code rejects. |
| `test-kit init` | Does not exist (decided) | `src/cli/run.js` has no `init`. `tests/integration/check-consumer-install.mjs` asserts `Unknown command: init`. `CHANGELOG.md` 0.2.0 says the package does not implement `init`. The `AGENTS.md` Layout table now says a project copies `templates/` by hand. |

## 3. Commands and flags

Source of truth: `bin/cli.js` (calls `run` in `src/cli/run.js`) and the `HELP`, `FLAGS` and `parseCommand` code there. The `--help` text of v0.5.0 and of `main` is byte-identical (measured 2026-10-19). Output is one line of JSON on stdout. An error prints a message on stderr and exits with 1. `-h`, `--help`, `-v` and `--version` work.

The package ships no command aliases and no alias file. In R4.1, R4.3 and R13.7 the aliases are scripts in the project (`visual:capture`, `visual:diff`, `test:visual`). They call the commands below. The mapping from each old project script to a command is not written down in this repository (`docs/migration-audit.md` lists the old scripts; `CHANGELOG.md` 0.2.0 says legacy command replacement is open). So the alias names are the project's, and the commands below are the package's side of the seam.

| Command | Required input | Marking | Reason |
| --- | --- | --- | --- |
| `capture` | `--side` (`--config`, `--label`, `--artifacts`, `--target`, `--viewport`, `--packs`, `--retries`, `--keep-existing`) | Frozen | R4.1. Shipped in 0.1.0. Exit 0 when the run is `complete`, otherwise 1. `--target` and `--viewport` are additions (R4.5): they select cells, record `selection` in `run.json` and change no hash. `--packs` is an addition in 1.1 (R13.51, owner decision of 2026-11-04, #231). It is a flag without a value. It runs the packs of the `packs` key on the open page. It is refused on a remote side. Without it nothing changes. `--retries N` is an addition in 1.3 (R5.14, ADR 0009, owner decision on #315 of 2026-11-06). N is an integer from 0 to 2. The default is 0, so a run without the flag is unchanged. It retries one failed cell, only for a transient error, and records `CAPTURE_RETRIED` as a warning. It enters no hash. `run`, `before` and `after` do not pass it. `--keep-existing` is an addition in 1.3 (R5.13, ADR 0009, owner decision on #315 of 2026-11-06). It is a flag without a value, and it needs a side with `remote: true`. It copies a capture from an earlier complete run of the store into the new run when seven rules hold. It adds `kept: { runId, at }` and the warning `REFERENCE_KEPT` to the entry, and `kept` (a count, only above zero) to the stdout line. It enters no hash. The core has no FORCE: omit the flag to capture fresh. The flag is not passed by `run`, `before` and `after`. |
| `import` | `--side` (`--config`, `--label`, `--target`, `--viewport`) | Frozen (decided) | R4.6. Imports the images of a design side into an immutable run. No browser. The provider `files` uses no network; the provider `figma` uses it only here, only to the Figma API and its image storage, with the token from `FIGMA_TOKEN` (R5.5). Output is one line of JSON: `id`, `state`, `images`, `manifestPath`. Exit 0 on a complete run, 1 on any error. The owner confirmed the name on 2026-11-06 (#288). |
| `diff` | `RUN_A RUN_B --output` (`--config`, `--kind`, `--checks`, `--fail-on-budget`, `--target`, `--viewport`, `--allowlist`) | Frozen | R4.1. Shipped in 0.1.0. `--kind` takes the six pair kinds of specification section 3. `--target` and `--viewport` are additions (R4.5): they filter the pair and the report records them in `meta.scope`. `--allowlist` is an addition (R9.12): it names the allowlist file, and the default is `test-kit.allowlist.json` beside the config. Old input still passes. |
| `summary` | `REPORT` (`--max-targets`, `--filter`, `--target`) | Frozen for name and flags. Output shape not frozen | R11.1 to R11.6. R11.6 returns `pair` today. It adds the `subject` key only when subject reports exist (`schemaVersion` 3). Addition in 1.1: `droppedRequestCount`, `droppedWarnings`, `droppedWarningsOmitted` and `droppedNotListed`, present only when a `font` or `stylesheet` request was aborted or a list was cut (R3.8). Addition: `skipped`, present only when the report skipped a cell (R4.5). Addition: `layout`, present only when a cell has a layout difference (R11.8, #350). |
| `serve` | `REPORT` (`--port`) | Frozen | Shipped in 0.1.0. Loopback server (`docs/usage.md`). |
| `query` | `REPORT --target --viewport --artifact` (`--max-lines`) | Frozen for name and flags. `--artifact` list is additive only | Today `html`, `status`, `content`, `behavior`, `layout`, `lighthouse`, `lint`, `a11y`. `layout` is an addition (R11.8, #350). |
| `record-known` | `REPORT --config --target --viewport --artifact --cause --reason` | Frozen | R5.3. Writes evidence into `known_diffs`. Addition in 1.1: `--artifact` accepts `status` (R6.13). Old input still passes. |
| `record-allowed` | `REPORT --target --check --reason --owner` (`--viewport`, `--fingerprint`, `--expires`, `--config`, `--allowlist`) | Experimental, decided 2026-11-06 | R9.12. Adds one entry to `test-kit.allowlist.json`. The counterpart of `record-known` for an absolute finding. It never edits an entry. `--fingerprint HASH` selects one finding when several match (owner decision 2026-11-06, #331). It refuses `lighthouse-budget`. |
| `perf` | `--side` and (`--targets` or `--path`) | Experimental | Needs Node 22.19 and the optional `lighthouse` peer. On a side with `production: true`, `perf` waits for `--consent` for any number of targets (R6.5, #162). |
| `run`, `before`, `after` | none (`--config`, `--side`, `--target` or `--path`, `--selector`, `--viewport`, `--suite`, `--checks`, `--contracts`, `--store`, `--ddev`) | Experimental | Shipped in 0.3.0. R13.13. Addition in 1.2: `before --side A` and `after --side B` may name two sides. The scope hash no longer holds the side, and the report kind follows the pair of sides (R3.11): the same local side gives `update`, the same remote side gives `deploy` (it gave `update` in 1.2.0-rc.1), a remote side then a local side gives `migration`, any other pair of different sides gives `adhoc` (#324). No new flag and no new command. Old input passes, but a baseline made before 1.2 never matches and needs `before` again. The owner decided this on 2026-11-06 (#240, option 1). The store keeps all runs. Nothing removes them automatically (specification section 17, item 4). `after` also takes `--allowlist` (R9.12), as `diff` does. |
| `report` | none (`--config`, `--store`, `--run`, `--port` or `--export`) | Experimental | Same reason as `run`. |
| `history` | none (`--config`, `--store`, `--port`, `--export`, `--publish` or `--prune`) | Experimental | Same reason as `run`. `--prune [--keep N] [--yes]` is new (R12.5, #161): the owner approved this flag on a frozen command on 2026-11-06. It removes runs only with `--yes`, and nothing runs by default. |

Other command facts:

- The code is the source for flags: `FLAGS` in `src/cli/run.js`. Two accepted flags are absent from `--help`: `diff --fail-on-budget` and `run`, `before`, `after` `--label`. Both are marked like their command.
- The default store directory `test-kit` is stable (R12.1). It was `.test-kit` before 1.2.0 (one-time exception to the freeze rule, #312). Its content layout is not part of the seam.
- `capture --artifacts` accepts `screenshot`, `html`, `status`, `content`, `behavior`, `layout`. The list is additive only. `layout` is an addition (R6.14, #350). `a11y` and `lint` are not accepted today. Packs run with `--packs`, not with `--artifacts` (R13.51).
- Exit codes beyond 0 and 1 do not exist in `src/cli/run.js`. `--fail-on-budget` is the only flag that changes an exit code for a finding (R6.11).
- `COMMANDS` and `run` are also exported from the package root (`src/index.js`). No README documents a project import of them. Experimental.

## 4. Contract API

### Content checks

Source of truth: `src/checks/index.js`, `src/checks/builtin/*.js`, specification section 7 (R7.1, R7.2, R7.7).

| Item | Marking | Reason |
| --- | --- | --- |
| The six built-in check IDs (`heading-outline`, `lang`, `empty-alt`, `empty-title`, `internal-links`, `text-difference`) | Experimental | They ship and a project names them in `checks`. None of the six exports `basis` (measured: no `export const basis` in `src/checks/builtin/`). R7.2 requires it. `src/packs/README.md` keeps them as they are. Deferred (decided): `basis` on the six waits for `schemaVersion` 3. |
| The check module shape `id`, `title`, `applies`, `check(value, ctx)` | Experimental | `basis` is part of the shape since `schemaVersion` 3 (specification section 7, first note). |
| A project adds its own stored content check by file | Not frozen, change planned | `builtinChecks` is a fixed list. A project selects a custom check through `resolveChecks` (section 5). |

### Behavior contracts

Source of truth: `src/behavior/contracts.js`, `src/behavior/README.md`, R7.7, R13.41.

| Item | Marking | Reason |
| --- | --- | --- |
| A contract exports `name`, `detect(page)`, `run(page, instance)`. `name` matches `^[a-z0-9][a-z0-9-]{0,79}$` and is unique | Frozen | `validateContracts` enforces it. |
| Optional `runScoping`, `projects`, `emulate`, `eagerImages`, `library` (`package`, `majors`) | Frozen for the names. Behavior beyond them is experimental | `contractApplicability` reads them. A mismatch gives `skipped` or `incompatible`, never a pass. |
| Contract files `*.contract.js` under `behavior.source` | Frozen | `loadProjectContracts`. |
| The default projects `desktop-1280` and `mobile-390` | Frozen | `DEFAULT_PROJECTS` in `src/behavior/contracts.js`. |
| The identity of a behavior finding (step ID against contract name) | Not frozen, decided 2026-11-04 | Each step carries `contract`. The catalog key is `behavior.<contract name>`, and the registry records the origin (ADR 0004, open question 1; R9.8). |
| The behavior snapshot version | Not frozen, decided 2026-11-04 | The version is 2 since `schemaVersion` 3 (it was 1), because each step carries `contract`. A stored version 1 snapshot does not compare with a version 2 snapshot. The pair reads `incompatible` (R8.9). Capture the older side again (#230). |
| The format of component allowlists | Not frozen, decided 2026-11-06 | R13.41 puts the format in the package. R9.12 defines it: `test-kit.allowlist.json`, `schemaVersion` 1, entries with `checkId`, `targetId`, `fingerprint`, `reason`, `owner`, optional `expires` and `message`. |
| Shared contracts `picture`, `gsap`, `lightgallery`, `header-*`, `cookieconsent`, `hygiene`, `render-integrity` | Not in the package | R13.42 plans them as packs. Only `swiper` and the axe pack ship. |

## 5. Pack API

Source of truth: `src/packs/define.js`, `src/packs/layers.js`, `src/packs/run.js`, `src/packs/snapshot.js`, `src/packs/README.md` (PR #114), R7.2, R8.7, R8.10, R13.42, ADR 0004.

| Item | Marking | Reason |
| --- | --- | --- |
| `definePack({ id, title, owner, checks })` | Frozen | `id` is lowercase kebab-case, at most 64 characters. A pack needs 1 to 100 checks and a named owner. |
| `validateCheck` and the check shape `id`, `title`, `basis`, `applies`, `check` | Frozen | `applies.artifacts` is required. `applies.components` is optional. |
| `LAYERS` = `package`, `project`, `component`, `page` | Frozen | A pack check has layer `package`. |
| `BASES` = `absolute`, `relative` | Frozen | R8.10. |
| `resolveChecks({ available, packs, custom, overrides })` | Frozen | It runs nothing. It rejects unknown packs, duplicate IDs and bad overrides. A narrower layer cannot replace a broader check. |
| An override: `checkId`, `layer`, `reason`, `owner`, optional `scope` (`targets`, `artifacts`, `kinds`) | Frozen | `scope.kinds` accepts only `single-run` (R8.5). An override makes the check `missing` with a diagnostic. It requires `reason` and `owner`. It is a different object from the allowlist, which stays open (ADR 0004, open question 4). |
| `runChecks(plan, { artifact, value }, context)` | Frozen | Returns `{ state, findings, checks, overrides }`. Checks are synchronous. |
| The finding: `severity` (`info`, `warning`, `error`), `message`, `evidence`; optional `targetId`, `viewportId`, `artifact`, `checkId`, `location` | Frozen | Unknown keys make the check `failed`. `layer` and `checkId` are set by `runChecks`. Caps: 1000 findings, 1000 characters of message, 10000 characters of evidence as JSON. These are chosen bounds, not measured numbers. A cap may rise without a break. |
| `location`: `{ file, line?, column? }` or `{ selector }` | Frozen | R9.11. Each string is at most 500 characters. A `column` needs a `line`. |
| States: check `complete`, `missing`, `failed`. Run state is the worst one | Experimental | R8.7 defines four states: `complete`, `missing`, `failed`, `incompatible` (ADR 0004, section 7, point 1 uses `incompatible` for absolute checks too). The pack code emits three. The set may gain `incompatible`. An open marker is exactly `evidence.state` of `incomplete` or `unknown`. |
| The input contract: JSON-like data, one frozen snapshot, one read of each caller field, fail closed | Frozen | `src/packs/snapshot.js`. Nesting limit 256 is a chosen bound. |
| The mapping of a pack finding to a `report.json` finding | Not frozen, change planned | The report finding has `id` and `causeId`. The pack finding has neither. No code maps one to the other. `schemaVersion` 3 (R9.8). |
| Threshold overrides | Not frozen, owner decision open | `src/packs/README.md` ("Not built yet"). |
| Allowlists for pack findings | Not frozen, decided 2026-11-06 | One allowlist for all absolute findings (R9.12). A pack finding has the fingerprint of an absolute finding. |
| Findings of completed checks in a mixed artifact | Decided 2026-10-23 | ADR 0004, open question 5 (#178, R8.12). |

Entry points in `package.json` `exports`. The list on `main` has nine entries. v0.5.0 had three. Nothing from v0.5.0 was removed (measured 2026-10-19).

| Entry point | Marking | Reason |
| --- | --- | --- |
| `.` (`src/index.js`) | Experimental | No README documents a project import. The owner decides whether the root stays public. |
| `./compat/selection`, `./compat/harvest` | Experimental | Planners for R4.3. `docs/migration-audit.md` and `CHANGELOG.md` 0.2.0 say legacy command replacement is open. |
| `./packs` | Frozen for `definePack`, `validateCheck`, `resolveChecks`, `runChecks`, `LAYERS`, `BASES` | See the table above. |
| `./packs` (`detectMajor`, `bundleBannerVersion`, `lockfileVersion`, `VERSION_SOURCES`, `defineContractSet`, `selectContractSet`, `defineVersionedPack`) | Experimental | Added in the same release cycle as the first pack. Only one library (Swiper) uses them. Vision open decision 10 (pack versioning) is open. |
| `./packs/a11y` | Frozen (decided) | Decided by the owner, 2026-10-19. The pack ID `a11y`, the check ID `a11y-axe`, the artifact shape and the axe result to pack finding mapping (`src/packs/a11y/README.md`, R8.14). The artifact kind `a11y` in the config, the report fields are not built. Frame injection into same-origin, `about:blank` and `srcdoc` frames is built (R13.51, #316); a state axis will not be built, because a state is its own target (ADR 0004). They arrive as additions. |
| `./packs/a11y/runner` | Frozen (decided) | Decided by the owner, 2026-10-19. `runAxe(page, options)` and its options. It needs the optional `axe-core` peer and Playwright. In-page injection has known limits (`src/packs/a11y/README.md`). |
| `./packs/swiper` | Experimental | The browser step that collects DOM facts and the version is not built (`src/packs/versioned/README.md`). |
| `./packs/lint`, `./packs/lint/runner` | Not frozen (decided) | Decided by the owner, 2026-10-19. The pack may change in minor releases. The ESLint and Stylelint seam is decided as entry points with a thin import (specification section 17, item 7; R13.40). It is not built yet. R13.40 fixes only the rule IDs and the `portadesign` namespace. The lint pack reads the output of the project's own linters. It does not move the rules. |
| `./eslint` | Addition for 1.1, built (decided) | Decided by the owner, 2026-10-22 and 2026-11-04 (issue #26). An ES module that default-exports a flat-config array, with the `portadesign` plugin. The rule IDs, the namespace and the rule options are frozen from the release that ships them (R13.40). Peers are optional (R13.46). A missing required peer throws `LINT_PEER_MISSING`. A missing enhancement peer drops its block with a warning (R13.47). Rule messages carry no project links, and `messageIds` stay (R13.50). Lint needs Node 20.19. A separate change raises `engines`. The config holds no project values (R13.48). Built in #270 (R13.46 to R13.50, ADR 0006). |
| `./stylelint` | Addition for 1.1, built (decided) | Same decision, with the 2026-11-05 details. A CommonJS file that exports a config object, so `require` and `import` both load it (R13.48). The `portadesign` rule IDs and options are frozen from the release that ships them (R13.40). Peers are optional (R13.46). A missing required peer throws `LINT_PEER_MISSING` (R13.47). |

A new pack that a project selects, a new contract set for a new library major, and a new entry point are additions (vision layers rules 6 to 9). Pack identity lives in stable contract IDs.

## 6. Report and sidecar versions

Source of truth: the `schemaVersion` literals in `src/` (grep, 2026-10-19), `docs/contracts.md`, specification section 9, ADR 0004.

| Document | Version in code | Marking | Reason |
| --- | --- | --- | --- |
| Config (`src/config/normalize.js`) | 1 | Frozen | See section 1. |
| Stored run `run.json` (`src/capture/index.js`, `src/cli/perf.js`) | 2 | Frozen | `src/compare/runs.js` and `src/rules/evidence.js` read only version 2. The optional field `targetSource` (what a styleguide source found) is an addition. |
| Report `report.json` (`src/compare/runs.js`, `src/report/model.js`) | 3 | Not frozen | The code writes version 3 (#230). Version 3 is not additive: `pair` becomes optional (R9.1, R9.7). A reader of version 2 rejects version 3. `adaptReport` reads versions 1, 2 and 3. The optional field `runs[].noFixture` (IDs of styleguide components with no fixture) is an addition. |
| Content snapshot (`src/content/snapshot.js`) and content comparison sidecar (`src/content/compare.js`) | 1 | Frozen | The extractor and check versions guard them (R7.4). |
| Optional addition to `run.json` capture entries and `report.json` rows, 1.1 | 2 (run), 3 (report) | Frozen | Optional addition to a frozen version (an optional key is not a break). `dropped` (and `droppedOmitted`) on a capture, `dropped: {a, b, omitted?}` on a report row. Absent when no request was aborted. R3.8. |
| Optional addition to `run.json` capture entries, after 1.1.0 | 2 (run) | Frozen (decided) | Optional addition to a frozen version. `design: { provider, source, importedAt, sha256, width, height }` on a capture of a design run (R4.6); the provider `figma` adds `fileKey` and `scale`. Absent on a browser capture. A design run has `settings.sides.<side>.kind` of `design`. The report schema does not change (R8.15). The owner confirmed it on 2026-11-06 (#288). |
| Optional addition to `run.json` capture entries, 1.2 | 2 (run) | Frozen (decided) | Optional addition to a frozen version. `recipe: { version, scope, settle }` on each captured entry that `capture` writes (R5.6, ADR 0007). `scopeHash` and `settleHash` stay and hash its parts. An entry with no `recipe` reads as version 1, with its scope and settle from its hashes and the run settings, as before. A design run and a `perf` run have no recipe. The run `settingsHash` does not change. The owner chose this shape on 2026-11-06 (#49). |
| Optional addition to `run.json` capture entries, 1.3 | 2 (run) | Frozen (decided) | Optional addition to a frozen version. `kept: { runId, at }` on a `captured` entry that `capture --keep-existing` copied from an earlier run (R5.13, ADR 0009). It is outside `recipe` and every hash. Absent otherwise. The same release adds the warning codes `REFERENCE_KEPT` and `CAPTURE_RETRIED` to the open list of R5.11. The owner decided on #315 on 2026-11-06. |
| Optional addition to `run.json` capture entries, layout | 2 (run) | Not frozen | Optional addition to a frozen version. `artifacts.layout: { kind, tool, version, settingsHash, browserVersion, state, path, bytes, sha256 }` and the file `layout/<target>/<viewport>.json` (layout snapshot `schemaVersion` 1, guarded by the extractor version), only when the run selects `layout` and the target declares parts (R6.14, #350). |
| Workflow state (`src/workflow/index.js`) | 1 | Experimental | It sits in the store. The store belongs to the experimental workflow commands. |

What `schemaVersion` 3 adds (R9.7 to R9.11, ADR 0004, #230). None of it is frozen:

- `pair` or `subject` (exactly one), and `subject.key`.
- The `checks` catalog, and `basis` on every check.
- `layer`, `runId` and `location` on a finding, and `checkId` on every non-screenshot finding.
- The `overrides` list.
- The absolute artifact index with `result: { violations, checks }`.
- The artifact kinds `a11y` and `lint`, and the reserved target `@project`.
- The artifact kind `layout` with its index (R9.13), the catalog check `layout`, and the `summary` key `layout` (R11.8, #350). An addition: a report without layout is unchanged.
- `scope.checks` on each artifact index, and the behavior key `behavior.<contract name>` (ADR 0004, open questions 1 and 2).
- The absolute `evidenceFingerprint` and the `allowlist` key with entry statuses (R9.8, R9.12; #254, ADR 0004, open questions 3 and 4). Not frozen. The `lighthouse-budget` finding has no fingerprint yet.

Frozen, whatever the version: R9.1. A reader adapts an older `report.json` and drops nothing. A file without `schemaVersion` is version 1 (`adaptV1` in `src/report/model.js`).

## Runtime requirement

| Item | Marking | Reason |
| --- | --- | --- |
| `engines.node` in `package.json` | Frozen (decided) | Narrowed to `>=20.19`. The owner approved the narrowing on issue #26 on 2026-11-05, because Stylelint 17 needs Node 20.19 (R13.48, ADR 0006). The value was `>=20`. This is a narrowing of a frozen item. The owner allowed it in the minor release 1.1.0 as a one-time exception to the freeze rule on 2026-11-06 (#298). A project on Node 20.0 to 20.18 must update Node before it updates the pin. Migration: run `node --version`, and install Node 20.19 or newer (22 works too). Capture, compare and report need nothing else. `CHANGELOG.md` records the change. |

## 7. Not frozen, owner decision open

| Item | Pointer |
| --- | --- |
| Pack versioning (one tag or one for each pack) | Vision open decision 10. |
| Version numbers before the release candidate | Vision open decision 7. |

## 8. Gaps found while writing this

1. Decided by the owner, 2026-10-19: there is no `init` command, and the package does not build one. `AGENTS.md` now says so.
2. (closed) The `packs` configuration key selects packs (R13.44). The selection stays in the key. Since 1.1, `capture --packs` runs the selected packs that have a page step (R13.51, #231). Without the flag no command runs a pack.
3. (closed) The six built-in checks export `basis` since `schemaVersion` 3 (#230). `text-difference` is `relative`, the other five are `absolute`.
4. Decided by the owner, 2026-10-19: the release candidate tag is `vMAJOR.MINOR.PATCH-rc.N` (R13.45). The freeze starts at `-rc.1`. Only the owner tags it.
5. (closed) Question: does a change of the package version make an old run incompatible (R8.9)? Answer, read in the code on 2026-10-19: no. A run does not record the package version. `run.json` `tools` holds the Playwright and Chromium versions and one entry for each other artifact. A comparison needs equal `settingsHash` values and equal Playwright and Chromium entries (`src/compare/runs.js`). The hash covers the viewports, the `settle` recipe, the screenshot settings, the browser settings and the behavior contract fingerprint. It does not cover the `packs` key. A change of the Playwright or Chromium version, or of a capture setting, does make a run incompatible. One consumer project compared runs from `v0.2.1` and `v1.0.0-rc.2` with `incompatible: 0` (verified once, local site). See [migration-guide-tailwind-base.md](migration-guide-tailwind-base.md), Part 1, step 6.
6. Decided by the owner, 2026-11-04 (issue #250): the default `runsRoot` moves from `tests/visual/runs` to `.test-kit/runs`, inside the ignored store, in `1.0.0`. It is a breaking change for a 0.x project that relies on the old default. It lands after `-rc.1`, so it is the last change of this default before 1.0. A project that sets `runsRoot` explicitly sees no change. A project that wants the old place sets `"runsRoot": "tests/visual/runs"`. See [upgrade-from-0.5.md](upgrade-from-0.5.md), "What breaks".

## 9. What this document did not check

- The tags `v1.0.0-rc.1` to `v1.0.0-rc.7`, `v1.0.0` and `v1.1.0-rc.1` to `v1.1.0-rc.3` exist now. This document was written before them.
- One consumer project ran `v1.0.0-rc.2` once, on 2026-10-19, against a local site (see the migration guide). No other project ran against the package. Every other statement about a project is derived from this repository.
- The viewer was not opened. The seam covers files, commands and the JSON that the code reads and writes.
- The cap values in the pack API are chosen bounds, not measurements.
