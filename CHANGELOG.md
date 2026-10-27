# Changelog

Versions follow semver. Each release uses an immutable git tag.

## [Unreleased]

### Added

- A remote side may set `challenge: "cloudflare"`. The capture then lets through a `POST` that is not a navigation to `/cdn-cgi/challenge-platform/` on its own origin, with plain characters in each path segment below it, so Cloudflare JavaScript detection no longer fails the capture. A redirect of that `POST` and every other non-read request still fail. A local side refuses the key (R3.5, #243).
- A remote run stops at the first Cloudflare challenge mark (`cf-mitigated`) or at a 403 or 429 on the page. The rest of the run sends no request (R3.6, #243).

## [1.0.0-rc.6] - 2026-10-27

Sixth release candidate for 1.0.0. It is not a stable release. A remote side can name itself with a User-Agent, Evidence opens on the worst target, and the viewer tab shows the tool mark.

### Added

- A remote side may set `userAgent`, so a site firewall that blocks `HeadlessChrome` lets the capture through. A local side refuses the key. The value is not part of the capture settings hash (R3.4, #241).

### Changed

- Evidence opens on the first target of the worst class when no target is selected. A target in a deep link or a click wins (#226).
- The viewer tab shows the tool mark as its icon. The icon is a same-origin file, so the `serve` CSP stays unchanged (R10.11, #237).
- The seam document records the owner's confirmation of the seam list (#236).

## [1.0.0-rc.5] - 2026-10-25

Fifth release candidate for 1.0.0. It is not a stable release. It fixes viewer findings of the redesign acceptance (#148), hardens two pack checks, and documents the server cache rule for a publish directory (#217).

### Fixed

- Muted viewer text takes its color from the token, not from opacity, so it meets the contrast rule in both themes (#219).
- The theme button shows its text at every width. "Clear filters" shows only when a filter is active. Decision commands stay on one line in a scroll box (#221).
- The target toggle label shows at every width (R10.2, #222, #227).
- The Evidence summary line is a named group, so its label reaches assistive technology (#216, #224).
- The viewer uses one ratio format everywhere. A ratio below 100 that rounds to 100 reads ">99.99%" (#206, #223).
- The pack snapshot walk stops at the depth limit when a frame is pushed, so a hostile Proxy cannot grow it without end. A failed copy of a contract set names the set (#115, #121, #233).
- The axe pack rejects a count of -0 in a stored artifact. Its README quotes the busy-page message of the code (#120, #234).

### Changed

- The tailwind-base migration guide names a server rule that serves the publish directory without a long cache (#217, #225).
- Seam, upgrade and migration documents name the existing tags and the pilot pin (#220, #228).

## [1.0.0-rc.4] - 2026-10-24

Fourth release candidate for 1.0.0. It is not a stable release. It replaces the viewer with the redesign of issue #148: a Home page with the history of comparisons, a report page with four views, and a deep link.

### Added

- The viewer Home lists the comparisons as a history, newest first, with the latest verdict, its counts and a verdict history (R10.2, #167, #168).
- The report page has four views: Overview, Evidence, Findings and Run info (R10.4, #171). It has a breadcrumb, the report time, and older and newer links (R10.3, #170).
- A deep link selects the report, the view, the target, the viewport, the evidence type and the finding (R10.14, #165, #174, #175). Behavior is an evidence type (#172).
- A finding offers four decision actions: Fix, Known difference, Noise or unstable, and Pass on. Each copies a link or a command (#197).
- `history --publish` writes `viewports` and `summary` for each report in `index.json` (R10.13, #160). `summary` agrees with the counts of the `summary` command. It is `null` for a legacy or invalid report. An index without them stays valid (schemaVersion 1).
- A side can carry `production: true`. `perf` against such a side needs `--consent` (#177).
- The review skill `vision-check` and the record checker `scripts/milestone/check-record.js` (#159).
- The design files `PRODUCT.md`, `DESIGN.md` and `docs/viewer-workflow.md`. They bind viewer work (#150, #151, #154).

### Fixed

- A target whose state is not `complete` never reads `match` (R8.12, R8.7, #189).
- `perf` refuses a remote side in its plan (R3.3, #181).
- The viewer treats an HTML body as a missing source and falls back to `index.json` (#147, #158).
- The viewer shows the source form only when `report.json` and `index.json` are both missing (R10.10, #169).
- Viewer accessibility and colors: every text size is at least 0.75rem (#185). Every control has a 2.75rem hit area on a coarse pointer (#187, #192). Badges and counts use the verdict colors of DESIGN.md (#186, #196). Red marks only unexplained, and an incomplete state is amber (#188, #191). The summary warning has a border, not a side stripe (#183).
- Viewer findings of the acceptance critique: a 1040px report column with incomplete shown as a state (#199), a verdict sentence on the report (#200), local run times with the ISO time in a title (#201), no green dot on local labels (#202), less repeated noise in the matrix (#205), a "View" group with the "Evidence type" label (#207), and no filters on Run info (#208).
- The viewer asks the server before it uses a cached `index.json`, `report.json` or evidence file, so a reload after a new publish shows the new data (#209, #210).
- The Filter group shows each class once: All, Unexplained and Match, with "More filters" for the other classes, Measurement and Cause (#203, #214).
- The Evidence view shows the run summary as one line with a "Run details" disclosure (#204, #215).

### Removed

- The viewer prototype mode for planned artifacts (#173).

### Changed

- Specify the viewer redesign (R10.2 to R10.5, R10.10, R10.13 to R10.15, #156) and record the owner decisions of 2026-10-22 (#164). The default set of checks is empty (R5.1). Snapshots stay until a person removes them.
- Measured findings of incomplete checks may set the target class (R8.12, #180).
- Spec wording notes after the ADR 0004 alignment (#176).
- DESIGN.md records the touch size rule (#195) and drops a stale badge color note (#190).
- DESIGN.md records the Filter group rule and the Evidence summary rule (#203, #204, #213).
- The migration guide records a second consumer run on 2026-10-23 (#136, #211).
- The `summary` and `query` output is pinned on fixtures (#157).
- README and `docs/rc-trial.md` put the static publish path first (#145).

## [1.0.0-rc.3] - 2026-10-20

Third release candidate for 1.0.0. It is not a stable release. It adds static-first output (ADR 0005): `history --publish DIR` writes a stable directory that the viewer reads without a server, and the viewer lists reports from its `index.json`. Try it with `docs/rc-trial.md`.

### Added

- Add to the viewer a list of reports and runs. It reads `index.json` of a publish directory when `report.json` is absent (R10.13).
- Add `buildPublishIndex` in `src/export/index-file.js`, the pure writer for the publish `index.json` (R10.13).
- Add `history --publish DIR` (R10.12, R10.13, ADR 0005). It refreshes one stable directory in place with a lock, a stage and a backup. It writes a marker, an `index.json`, one viewer copy, `run.json` files and report evidence. A report with missing or too large evidence, or one that fails validation, is listed with `path` `null`. It checks `DIR` again immediately before the swap and refuses a missing history store. It refuses unsafe directories before any write and reports crash states with the recovery table. It is opt-in and cannot combine with `--export` or `--port`.

### Changed

- Move `validId` to `src/history/valid-id.js`, so the pure index writer does not import the history I/O module. `src/history/index.js` still exports it. `buildPublishIndex` now throws when `now` is `null` or missing.
- Split `writeReportEvidence` out of `exportReport` in `src/export/report.js`. Export output is unchanged.
- Specify static-first output (ADR 0005). R10.1 and R10.11 change. R10.12 (in-place refresh of a publish directory) and R10.13 (`index.json`) are new. The vision gains a "Static first" section. The code now follows: the index writer, `history --publish` and the viewer list of reports from `index.json` exist.
- Record what one consumer project verified once with `v1.0.0-rc.2` on a local site. This changes documents only.
- Update `docs/migration-guide-tailwind-base.md`. The candidate tags exist. The verified steps are marked. The report path is free.
- Answer the R8.9 question in the guide and in `docs/seam.md`. A package version change does not make a run incompatible. A Playwright or Chromium version change does.
- Add to `docs/rc-trial.md` how to tell a candidate from a stable 1.0.0. Say that Playwright 1.64.1 is the tested version, not a requirement.
- Add a note on `git+ssh` URLs in the lockfile to the install documents. One consumer project saw them with npm 11.19 and 11.20. The note gives the `git+https` workaround.
- State in `README.md` that `--ddev` replaces the origin of the side. A side may name an `https://*.ddev.site` origin.

## [1.0.0-rc.2] - 2026-10-19

Second release candidate for 1.0.0. The owner tags it. It is not a stable release. It holds the changes merged since `1.0.0-rc.1`. They are repository setup and dependency updates. No change to the package code, the project configuration or the report format. The compiled viewer is rebuilt with a newer Vue. Try it with `docs/rc-trial.md`.

### Added

- Add Dependabot for the root package, `frontend/` and GitHub Actions, a code owners file, a pull request template and issue templates. These files are not part of the package. Dependabot opened its first update pull requests (#130 to #134) after the setup landed on `main`.

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
