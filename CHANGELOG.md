# Changelog

Versions follow semver. Each release uses an immutable git tag.

## [Unreleased]

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
