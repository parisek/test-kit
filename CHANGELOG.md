# Changelog

Versions follow semver. Each release uses an immutable git tag.

## [Unreleased]

### Changed

- Align the specification with `docs/vision.md` (R13.9, R13.25, R13.26, R13.42). While the package is alpha, a step may break a project. Dev prerelease tags `vMAJOR.MINOR.PATCH-dev.N` are not releases. Accessibility and component packs move into the package as opt-in entry points.
- Relabel the content, behavior and Lighthouse sections of `docs/contracts.md` from "(unreleased)" to "(v0.2.0)". They shipped in v0.2.0. This is separate from the merge rule and R13.x.
- Accept ADR 0004 (one result model, option C) and change R7.3: a class applies by the basis of the check, and normaliser rules and known differences apply to relative checks only (R7.3, R11.6). No code changes. The schema, validator, classifier and viewer work follows in later pull requests (R13.9).
- Align the specification with accepted ADR 0004 (R7.2, R7.3, R8.2 to R8.7, R8.10 to R8.13, R9.1, R9.7 to R9.11, R10.5, R11.6). Define the check basis, the `subject` report, the `checks` catalog and `schemaVersion` 3. The code still writes version 2. No code changes (R13.9).
- State one merge rule in `AGENTS.md` and `docs/development-loop.md`.

### Migration

- Breaking, planned (R13.9): the report schema goes to version 3, where `pair` is optional. Code that does this is not in this change. A reader of version 2 will fail at `schemaVersion`. No project change is needed today.
- No project change is needed. A project that pins a tag sees no change. `release.yml` runs on stable tags only. A dev tag starts no run and creates no GitHub Release.

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
