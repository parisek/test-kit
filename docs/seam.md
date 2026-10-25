# The project seam

Status: proposal for the owner, with four decisions recorded (marked "decided"). It serves vision open decision 9 and issue #105. It cites R13.9, R13.25 to R13.27, R13.40, R13.41 and R13.43.
The owner confirms the list when the owner approves the 1.0 release candidate. Until then the list is a proposal, except the decided points. A marking below is the agent's reading of the code on 2026-10-19 (`package.json` version 0.5.0 at that time; the candidate sets 1.0.0; `main` at 245611d). Rows that describe the `packs` key (R13.44) read `main` at dcea71a. The owner decided four points on 2026-10-19: `init` does not exist, the axe `incomplete` rule (R8.14), `basis` waits for `schemaVersion` 3, and the freeze scope of the packs. They are marked "decided" below.

The seam is everything a project touches: its configuration file, the commands it calls, the contract and pack API it imports, the data it stores, and the files it copies.

## The freeze rule

- Before the first release candidate tag (`vX.Y.Z-rc.1`, R13.45), a break of any item costs nothing. The package is alpha (vision, Maturity; R13.9). A break needs a changelog entry and a migration note.
- From the first release candidate tag, the freeze starts. A change to a frozen item needs a new major version and a migration note. An addition that old input still passes is not a change.
- The major-version consequence is a proposal. Vision open decision 9 says only "freeze". The form of the release candidate tag is decided: `vMAJOR.MINOR.PATCH-rc.N` (R13.45, owner decision, 2026-10-19). Only the owner tags it.
- A project pins an exact tag until 1.0 (R13.27). The lockfile pins the commit. A break reaches a project only when it updates the pin.
- Only the owner approves and tags a stable release (R13.25, R13.26). This document names no tag and no date. Only the owner tags a release candidate (R13.45). The tags `v1.0.0-rc.1` to `v1.0.0-rc.4` exist (2026-10-24).
- The word "freeze" does not extend to anything marked "not frozen". Those items may still change in a minor version.

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
| `sides.<id>.origin` | string | none | yes | An HTTP origin with no path or credentials. Local unless `remote` is `true`. |
| `sides.<id>.remote` | boolean | `false` | no | R3.3. Added in 0.5.0. |
| `sides.<id>.production` | boolean | `false` | no | R6.5. `perf` on this side waits for `--consent` for any number of targets. The side id does not decide. Added in 1.0.0-rc.4. |
| `sides.<id>.settle` | object | see below | no | Settle recipe (R5.4). |
| `targets` | list | none | yes | 1 to 1000 entries. |
| `targets[].id` | string | none | yes | Safe ID. Unique. |
| `targets[].kind` | string | none | yes | `page` or `component`. |
| `targets[].title` | string | the `id` | no | |
| `targets[].path` | string | none | one of | Origin-relative path. Every side needs `path` or a `paths` entry. |
| `targets[].paths` | object | none | one of | Path for each side ID. |
| `targets[].selector` | string or list | none | no | CSS selector, or 1 to 50 unique selectors. |
| `targets[].box` | string | none | no | `border` or `content`. Needs `selector`. |
| `targets[].settle`, `targets[].settleBySide` | object | none | no | Partial settle recipe, for all sides or for one side. |
| `viewports` | list | none | yes | 1 to 20 entries. |
| `viewports[].id`, `width`, `height` | string, number, number | none | yes | Width and height 1 to 4096. At most 32 million physical pixels. |
| `viewports[].deviceScaleFactor` | number | `1` | no | 0.5 to 3. |
| `artifacts` | list | `["screenshot"]` | no | 1 to 5 of `screenshot`, `html`, `status`, `content`, `behavior`. Additive only. |
| `checks` | list | `[]` | no | At most 6 built-in content check IDs. Needs the `content` artifact. |
| `packs` | list | `[]` | no | Built-in pack IDs: `a11y`, `lint`, `swiper`. No duplicates. No options. Nothing runs when the key is absent (R13.44, R5.1). Added after 0.5.0. |
| `runsRoot` | string | `tests/visual/runs` | no | Plain relative path. |
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
| `sides.<id>.settle` fields | | `waitMs` 0, `selectors` `[]`, `disableMotion` `true`, `masks` `[]` | no | Optional `reveal` (list of `click`, `hover` or `focus` steps) and `lazyImages` (boolean). |

Items inside the configuration that stay open:

| Item | Marking | Reason |
| --- | --- | --- |
| The default set of `artifacts` and `checks` | Decided by the owner on 2026-10-22 | Specification section 17, item 2. The defaults are `["screenshot"]` and `[]`. No check runs by default (R5.1). |
| Options for a selected pack | Not frozen, owner decision open | The `packs` key takes IDs only (R13.44). The pack API has no options. A pack that needs options needs a new decision. |
| The ESLint and Stylelint seam | Decided by the owner on 2026-10-22, not built yet | Specification section 17, item 7, R13.40: `@parisek/test-kit/eslint` (flat-config array) and `@parisek/test-kit/stylelint` (config object) with a thin import (#105). |
| The allowlist (`reason`, `owner`) | Not frozen, owner decision open | ADR 0004, open question 4. No config key exists. |
| Selection of checks or contracts per target | Not frozen, owner decision open | ADR 0004, open question 2. |
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
| `capture` | `--side` (`--config`, `--label`, `--artifacts`) | Frozen | R4.1. Shipped in 0.1.0. Exit 0 when the run is `complete`, otherwise 1. |
| `diff` | `RUN_A RUN_B --output` (`--config`, `--kind`, `--checks`, `--fail-on-budget`) | Frozen | R4.1. Shipped in 0.1.0. `--kind` takes the six pair kinds of specification section 3. |
| `summary` | `REPORT` (`--max-targets`, `--filter`, `--target`) | Frozen for name and flags. Output shape not frozen | R11.1 to R11.6. R11.6 returns `pair` today. It adds the `subject` key only when subject reports exist (`schemaVersion` 3). |
| `serve` | `REPORT` (`--port`) | Frozen | Shipped in 0.1.0. Loopback server (`docs/usage.md`). |
| `query` | `REPORT --target --viewport --artifact` (`--max-lines`) | Frozen for name and flags. `--artifact` list is additive only | Today `html`, `status`, `content`, `behavior`, `lighthouse`. |
| `record-known` | `REPORT --config --target --viewport --artifact --cause --reason` | Frozen | R5.3. Writes evidence into `known_diffs`. |
| `perf` | `--side` and (`--targets` or `--path`) | Experimental | Needs Node 22.19 and the optional `lighthouse` peer. On a side with `production: true`, `perf` waits for `--consent` for any number of targets (R6.5, #162). |
| `run`, `before`, `after` | none (`--config`, `--side`, `--target` or `--path`, `--selector`, `--viewport`, `--suite`, `--checks`, `--contracts`, `--store`, `--ddev`) | Experimental | Shipped in 0.3.0. R13.13. The store keeps all runs. Nothing removes them automatically (specification section 17, item 4). |
| `report` | none (`--config`, `--store`, `--run`, `--port` or `--export`) | Experimental | Same reason as `run`. |
| `history` | none (`--config`, `--store`, `--port` or `--export`) | Experimental | Same reason as `run`. |

Other command facts:

- The code is the source for flags: `FLAGS` in `src/cli/run.js`. Two accepted flags are absent from `--help`: `diff --fail-on-budget` and `run`, `before`, `after` `--label`. Both are marked like their command.
- The default store directory `.test-kit` is stable (R12.1). Its content layout is not part of the seam.
- `capture --artifacts` accepts `screenshot`, `html`, `status`, `content`, `behavior`. The list is additive only. `a11y` and `lint` are not accepted today.
- Exit codes beyond 0 and 1 do not exist in `src/cli/run.js`. `--fail-on-budget` is the only flag that changes an exit code for a finding (R6.11).
- `COMMANDS` and `run` are also exported from the package root (`src/index.js`). No README documents a project import of them. Experimental.

## 4. Contract API

### Content checks

Source of truth: `src/checks/index.js`, `src/checks/builtin/*.js`, specification section 7 (R7.1, R7.2, R7.7).

| Item | Marking | Reason |
| --- | --- | --- |
| The six built-in check IDs (`heading-outline`, `lang`, `empty-alt`, `empty-title`, `internal-links`, `text-difference`) | Experimental | They ship and a project names them in `checks`. None of the six exports `basis` (measured: no `export const basis` in `src/checks/builtin/`). R7.2 requires it. `src/packs/README.md` keeps them as they are. Deferred (decided): `basis` on the six waits for `schemaVersion` 3. |
| The check module shape `id`, `title`, `applies`, `check(value, ctx)` | Experimental | `basis` joins the required set at `schemaVersion` 3 (specification section 7, first note). |
| A project adds its own stored content check by file | Not frozen, change planned | `builtinChecks` is a fixed list. A project selects a custom check through `resolveChecks` (section 5). |

### Behavior contracts

Source of truth: `src/behavior/contracts.js`, `src/behavior/README.md`, R7.7, R13.41.

| Item | Marking | Reason |
| --- | --- | --- |
| A contract exports `name`, `detect(page)`, `run(page, instance)`. `name` matches `^[a-z0-9][a-z0-9-]{0,79}$` and is unique | Frozen | `validateContracts` enforces it. |
| Optional `runScoping`, `projects`, `emulate`, `eagerImages`, `library` (`package`, `majors`) | Frozen for the names. Behavior beyond them is experimental | `contractApplicability` reads them. A mismatch gives `skipped` or `incompatible`, never a pass. |
| Contract files `*.contract.js` under `behavior.source` | Frozen | `loadProjectContracts`. |
| The default projects `desktop-1280` and `mobile-390` | Frozen | `DEFAULT_PROJECTS` in `src/behavior/contracts.js`. |
| The identity of a behavior finding (step ID against contract name) | Not frozen, owner decision open | ADR 0004, open question 1. |
| The format of component allowlists | Not frozen, owner decision open | R13.41 puts the format in the package. ADR 0004, open question 4 leaves the allowlist unspecified. |
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
| Threshold overrides and allowlists | Not frozen, owner decision open | `src/packs/README.md` ("Not built yet"). ADR 0004, open question 4. |
| Findings of completed checks in a mixed artifact | Not frozen, owner decision open | ADR 0004, open question 5. |

Entry points in `package.json` `exports`. The list on `main` has nine entries. v0.5.0 had three. Nothing from v0.5.0 was removed (measured 2026-10-19).

| Entry point | Marking | Reason |
| --- | --- | --- |
| `.` (`src/index.js`) | Experimental | No README documents a project import. The owner decides whether the root stays public. |
| `./compat/selection`, `./compat/harvest` | Experimental | Planners for R4.3. `docs/migration-audit.md` and `CHANGELOG.md` 0.2.0 say legacy command replacement is open. |
| `./packs` | Frozen for `definePack`, `validateCheck`, `resolveChecks`, `runChecks`, `LAYERS`, `BASES` | See the table above. |
| `./packs` (`detectMajor`, `bundleBannerVersion`, `lockfileVersion`, `VERSION_SOURCES`, `defineContractSet`, `selectContractSet`, `defineVersionedPack`) | Experimental | Added in the same release cycle as the first pack. Only one library (Swiper) uses them. Vision open decision 10 (pack versioning) is open. |
| `./packs/a11y` | Frozen (decided) | Decided by the owner, 2026-10-19. The pack ID `a11y`, the check ID `a11y-axe`, the artifact shape and the axe result to pack finding mapping (`src/packs/a11y/README.md`, R8.14). The artifact kind `a11y` in the config, the browser step per component state, frame injection and the report fields are not built. They arrive as additions. |
| `./packs/a11y/runner` | Frozen (decided) | Decided by the owner, 2026-10-19. `runAxe(page, options)` and its options. It needs the optional `axe-core` peer and Playwright. In-page injection has known limits (`src/packs/a11y/README.md`). |
| `./packs/swiper` | Experimental | The browser step that collects DOM facts and the version is not built (`src/packs/versioned/README.md`). |
| `./packs/lint`, `./packs/lint/runner` | Not frozen (decided) | Decided by the owner, 2026-10-19. The pack may change in minor releases. The ESLint and Stylelint seam is decided as entry points with a thin import (specification section 17, item 7; R13.40). It is not built yet. R13.40 fixes only the rule IDs and the `portadesign` namespace. The lint pack reads the output of the project's own linters. It does not move the rules. |

A new pack that a project selects, a new contract set for a new library major, and a new entry point are additions (vision layers rules 6 to 9). Pack identity lives in stable contract IDs.

## 6. Report and sidecar versions

Source of truth: the `schemaVersion` literals in `src/` (grep, 2026-10-19), `docs/contracts.md`, specification section 9, ADR 0004.

| Document | Version in code | Marking | Reason |
| --- | --- | --- | --- |
| Config (`src/config/normalize.js`) | 1 | Frozen | See section 1. |
| Stored run `run.json` (`src/capture/index.js`, `src/cli/perf.js`) | 2 | Frozen | `src/compare/runs.js` and `src/rules/evidence.js` read only version 2. |
| Report `report.json` (`src/compare/runs.js`, `src/report/model.js`) | 2 | Not frozen, change planned | R9.1 says version 3 is not additive: `pair` becomes optional. A reader of version 2 rejects version 3. The code still writes 2. |
| Content snapshot (`src/content/snapshot.js`) and content comparison sidecar (`src/content/compare.js`) | 1 | Frozen | The extractor and check versions guard them (R7.4). |
| Workflow state (`src/workflow/index.js`) | 1 | Experimental | It sits in the store. The store belongs to the experimental workflow commands. |

What waits for `schemaVersion` 3 (R9.7 to R9.11, ADR 0004). None of it is frozen:

- `pair` or `subject` (exactly one), and `subject.key`.
- The `checks` catalog, and `basis` on every check.
- `layer`, `runId` and `location` on a finding, and `checkId` on every non-screenshot finding.
- The `overrides` list.
- The absolute artifact index with `result: { violations, checks }`.
- The artifact kinds `a11y` and `lint`, and the reserved target `@project`.
- Selection per target, the absolute fingerprint, and the allowlist (ADR 0004, open questions 2 to 4).

Frozen, whatever the version: R9.1. A reader adapts an older `report.json` and drops nothing. A file without `schemaVersion` is version 1 (`adaptV1` in `src/report/model.js`).

## 7. Not frozen, owner decision open

| Item | Pointer |
| --- | --- |
| The allowlist file, with `reason` and `owner` | ADR 0004, open question 4. |
| Behavior identity | ADR 0004, open question 1. |
| Selection per target | ADR 0004, open question 2. |
| The absolute fingerprint | ADR 0004, open question 3. |
| Findings of completed checks in a mixed artifact | ADR 0004, open question 5. |
| Pack versioning (one tag or one for each pack) | Vision open decision 10. |
| Version numbers before the release candidate | Vision open decision 7. |

## 8. Gaps found while writing this

1. Decided by the owner, 2026-10-19: there is no `init` command, and the package does not build one. `AGENTS.md` now says so.
2. (closed) The `packs` configuration key selects packs (R13.44). No command line flag selects a pack. No command runs the selected packs yet.
3. The six built-in checks export no `basis`, although R7.2 requires it. Decided by the owner, 2026-10-19: deferred to `schemaVersion` 3. It is not an open question.
4. Decided by the owner, 2026-10-19: the release candidate tag is `vMAJOR.MINOR.PATCH-rc.N` (R13.45). The freeze starts at `-rc.1`. Only the owner tags it.
5. (closed) Question: does a change of the package version make an old run incompatible (R8.9)? Answer, read in the code on 2026-10-19: no. A run does not record the package version. `run.json` `tools` holds the Playwright and Chromium versions and one entry for each other artifact. A comparison needs equal `settingsHash` values and equal Playwright and Chromium entries (`src/compare/runs.js`). The hash covers the viewports, the `settle` recipe, the screenshot settings, the browser settings and the behavior contract fingerprint. It does not cover the `packs` key. A change of the Playwright or Chromium version, or of a capture setting, does make a run incompatible. One consumer project compared runs from `v0.2.1` and `v1.0.0-rc.2` with `incompatible: 0` (verified once, local site). See [migration-guide-tailwind-base.md](migration-guide-tailwind-base.md), Part 1, step 6.

## 9. What this document did not check

- The tags `v1.0.0-rc.1` to `v1.0.0-rc.4` exist now. This document was written before them.
- One consumer project ran `v1.0.0-rc.2` once, on 2026-10-19, against a local site (see the migration guide). No other project ran against the package. Every other statement about a project is derived from this repository.
- The viewer was not opened. The seam covers files, commands and the JSON that the code reads and writes.
- The cap values in the pack API are chosen bounds, not measurements.
