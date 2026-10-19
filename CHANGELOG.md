# Changelog

Versions follow semver. Each release uses an immutable git tag.

## [Unreleased]

## [1.0.0-rc.2] - 2026-10-19

Second release candidate for 1.0.0. The owner tags it. It is not a stable release. It holds the changes merged since `1.0.0-rc.1`. They are repository setup and dependency updates. No change to the package runtime, the project configuration or the report format. Try it with `docs/rc-trial.md`.

### Added

- Add Dependabot for the root package, `frontend/` and GitHub Actions, a code owners file, a pull request template and issue templates. These files are not part of the package. Dependabot version updates start once this is on `main`.

### Changed

- Rebuild the viewer (`viewer/app.js`) with Vue 3.5.44. `THIRD_PARTY_NOTICES.txt` names Vue 3.5.44. The other `frontend/` dev dependencies move to `@vitejs/plugin-vue` 6.0.10, `vitest` 5.0.5 and `jsdom` 30.1.3.
- Pin the dev dependency `@playwright/test` to 1.64.1. `docs/rc-trial.md` installs the same version and uses the tag `v1.0.0-rc.2`.
- Update the CI actions to `actions/checkout` 7, `actions/setup-node` 7 and `amannn/action-semantic-pull-request` 6.1.1. `release.yml` uses checkout 7 and setup-node 7. The tag rules and the checks in `release.yml` do not change.

## [1.0.0-rc.1] - 2026-10-19

First release candidate for 1.0.0. The owner tags it. It is not a stable release. The seam freeze in `docs/seam.md` starts at this tag. The candidate holds the changes merged since 0.5.0. Try it with `docs/rc-trial.md`.

### Added

- Add the opt-in accessibility pack `@parisek/test-kit/packs/a11y` (R7.2, R13.42, R8.7, issue 102). It maps axe-core results to findings with layer `package`, the axe rule id, severity from impact, and evidence (selector, capped HTML, help URL). A thin runner `@parisek/test-kit/packs/a11y/runner` injects axe-core into a Playwright page. `axe-core` is an optional peer dependency. A missing run gives `missing`. A broken run, bad options or a run in which no rule ran gives `failed`. None gives `complete`. An axe `incomplete` rule and cut evidence each give a `warning` finding and do not open the check. Every violation rule gives a finding, and rule counts are reconciled. Nothing runs by default (R5.1). No report change.
- Add the pack entry point `@parisek/test-kit/packs` (R7.2, R13.42, R13.43). It defines packs, layers custom checks (package, project, component, page) and runs them with fail-closed states (R8.7). Nothing runs by default (R5.1). No report change: the code still writes `schemaVersion` 2.
- Add versioned component contracts to the packs API (R13.42, R8.7). `detectMajor` reads an exact version and its source. `defineContractSet` and `defineVersionedPack` build contract sets keyed by library major, each with an owner. The new entry point `@parisek/test-kit/packs/swiper` holds Swiper 12 and Swiper 14 sets. An unknown or unsupported version gives `missing`, never a pass. Nothing runs by default (R5.1).

- Add the opt-in `lint` pack (`@parisek/test-kit/packs/lint`, R7.2, R8.10, R9.9, R9.11, #103). It reads ESLint and Stylelint JSON as two absolute checks, `eslint-rules` and `stylelint-rules`. A finding may carry a top-level `location` (R9.11). The runner `@parisek/test-kit/packs/lint/runner` starts the project's own linters in a process group with a timeout and a reduced environment. A missing tool gives `missing`, a crash or bad output gives `failed`, and exit code 1 with findings is a normal run (R8.7). Nothing runs by default (R5.1). No report change: `schemaVersion` stays 2.

- Document the project seam, the upgrade from v0.5.0 and a migration guide for a project that pins an old version (issue 105, vision open decision 9). Documentation only. No code, configuration or report change: `docs/seam.md`, `docs/upgrade-from-0.5.md`, `docs/migration-guide-tailwind-base.md`.
- Add the optional `packs` key to the project configuration (R13.44, #125). It takes a list of built-in pack IDs: `a11y`, `lint`, `swiper`. An absent key selects nothing (R5.1). An unknown ID, a duplicate or a value that is not an ID fails validation. The key takes no options. No command runs the selected packs yet.
- Add the vision (`docs/vision.md`), ADR 0004 for the result model (`docs/adr/0004-result-model.md`) and the process skills proposal (`docs/process-skills.md`).
- Add the trial guide `docs/rc-trial.md`.

### Changed

- Define the release candidate tag `vMAJOR.MINOR.PATCH-rc.N` (R13.45, R13.26). Only the owner tags it. `release.yml` now also runs on an rc tag, applies the same checks and creates a GitHub Release marked as a prerelease from the changelog section `[X.Y.Z-rc.N]`. A stable tag behaves as before. A dev tag still starts no run. A new unit test reads the workflow file.
- Align the specification with `docs/vision.md` (R13.9, R13.25, R13.26, R13.42). While the package is alpha, a step may break a project. Dev prerelease tags `vMAJOR.MINOR.PATCH-dev.N` are not releases. Accessibility and component packs move into the package as opt-in entry points.
- Relabel the content, behavior and Lighthouse sections of `docs/contracts.md` from "(unreleased)" to "(v0.2.0)". They shipped in v0.2.0. This is separate from the merge rule and R13.x.
- Accept ADR 0004 (one result model, option C) and change R7.3: a class applies by the basis of the check, and normaliser rules and known differences apply to relative checks only (R7.3, R11.6). No code changes. The schema, validator, classifier and viewer work follows in later pull requests (R13.9).
- Align the specification with accepted ADR 0004 (R7.2, R7.3, R8.2 to R8.7, R8.10 to R8.13, R9.1, R9.7 to R9.11, R10.5, R11.6). Define the check basis, the `subject` report, the `checks` catalog and `schemaVersion` 3. The code still writes version 2. No code changes (R13.9).
- State one merge rule in `AGENTS.md` and `docs/development-loop.md`.

- Run `release.yml` on stable tags (#110) and on rc tags (R13.45). A dev tag starts no run.
- Record the owner decisions of 2026-10-19: the package has no `init` command, the axe `incomplete` rule (R8.14), `basis` waits for `schemaVersion` 3, and the freeze scope of the packs (#124).
- Set `package.json` and `package-lock.json` to version `1.0.0` for the tag `v1.0.0-rc.1`.
- Note: the code still writes `schemaVersion` 2 and the built-in checks still export no `basis`. Both wait for `schemaVersion` 3.

### Fixed

- Fix `run`, `before` and `after` for a config without an `artifacts` key (R5.1, #128). Suite `all` now uses the same default as config validation (`screenshot`). Before, they stopped with "Unknown suite". No report change.

### Migration

- Breaking, planned (R13.9): the report schema goes to version 3, where `pair` is optional. Code that does this is not in this change. A reader of version 2 will fail at `schemaVersion`. No project change is needed today.
- No project change is needed. A project that pins a tag sees no change. `release.yml` runs on stable tags and rc tags (R13.45). A dev tag starts no run and creates no GitHub Release.

## [0.5.0] - 2026-10-13

### Added

- Capture a deployed site read-only with `remote: true` on a side. Compare it with a local side or with itself over time (R3.3).
- A remote side verifies TLS certificates, allows only `GET` and `HEAD`, drops frames and subresources of other origins, and fails the capture on a redirect, popup or top-level navigation that leaves its origin. `perf` and `--ddev` refuse it. A side without `remote: true` behaves as in 0.4.0.

## [0.4.0] - 2026-10-12

### Added

- Export report viewers and local history as portable static directories.
- Share the server evidence allowlist with export and give untrusted HTML inert names.

### Fixed

- Resolve viewer report and artifact URLs within their mounted directory prefix.

## [0.3.0] - 2026-10-11

### Added

- Own scoped run, baseline, comparison, report, and local history commands in the package.
- Store opt-in workflow evidence under a stable configurable local directory.
- Select content checks and browser contracts by stable names. Preserve skipped and incomplete evidence.
- Keep one complete baseline per selection and retain all local runs without automatic deletion.

## [0.2.1] - 2026-10-10

### Fixed

- Inset filter chevrons from the control edge. Reserve space between labels and arrows.

## [0.2.0] - 2026-10-10

### Added

- Capture compressed local content and run explicit checks without another crawl.
- Run project behavior contracts and retain failed steps, screenshots and local traces.
- Measure repeated local HTTP Lighthouse audits with load, noise and budget guards.
- Show real content, behavior and speed evidence in the viewer and bounded queries.

- Capture opt-in HTML response bytes and bounded HTTP status from the same navigation.
- Compare response sidecars, show safe text evidence, and query bounded artifact details.

- Link each measured audit to its original local Lighthouse HTML and JSON report.
- Add opt-in selector unions, content-box geometry, lazy-image settlement and target reveal recipes.
- Bind comparisons and recorded evidence to the effective target scope and settlement recipe.
- Export bounded legacy selection and harvest planners without browser dependencies.
- Verify packed installs in synthetic parent, WordPress and Drupal layouts.

### Changed

- Show A/B run labels, sides, capture dates, and global availability notices.
- Filter target lists by class, measurement state, and cause. Open exact viewport evidence.

- Build the viewer with Vue 3, Vite, and Tailwind 4. Ship the compiled files.
- Copy a pinned company UI token contract with provenance and licence notices.
- Open the first view from the pair kind and retain incomplete evidence.
- Verify component behavior, reproducible builds, mobile focus, and installed packages.

### Scope

- New artifacts, content checks and settlement recipes stay opt-in.
- Lighthouse requires Node 22.19 or newer and supports local HTTP pages only.
- Original Lighthouse HTML downloads remain local. Open them in a browser for the native interface.
- Legacy command replacement, lint migration and real CMS/DDEV pilot validation remain open.
- The package does not implement `init`. Copy and configure the included template for the pilot.
- This release does not change existing project aliases or snapshot assertion gates.

## [0.1.0] - 2026-10-09

### Added

- Explicit JSON configuration for local sides, targets, viewports, and settle settings.
- Chromium screenshot capture with frozen settings and partial-run evidence.
- Offline screenshot comparison with full-resolution originals and pixel regions.
- Shared report validation and classification for the viewer and bounded summary.
- Local report viewer and a read-only loopback report server.
- Separate measurement states and HTTP availability diagnostics.
- Synthetic integration fixtures and a local DDEV pilot recipe.
- MIT licence and git-tag installation with release checks.

### Scope

- Screenshots are the only enabled artifact. No content checks run by default.
- HTML, behavior, content, performance, lint migration, and legacy command migration remain later milestones.
- Pixel ratios provide evidence. They do not impose a pass or fail gate.
