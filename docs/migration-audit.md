# Migration audit

This audit supports TK-02 and R13.9–R13.11. It reads source files. It does not
run the old capture commands or change a downstream project.

## Source snapshot

The audit reads the local `tailwind-base` static theme on 2026-10-09. It also
reads the `wordpress-base` and `drupal-base` static theme package scripts.
The `tailwind-base` HEAD is `fc4004393643f49214f28c765b27e682f70fbc8e`.
The inventory reads the working tree, so local changes can affect its result.
The counts below come from `git ls-files`. They include tests and fixtures.
They exclude ignored screenshots, runs and installed dependencies.

| Area | Tracked files |
| --- | ---: |
| visual | 15 |
| lib | 46 |
| behavior | 22 |
| eslint | 17 |
| stylelint | 14 |

These are source-tree counts. They are not the skeleton-manifest counts in
specification section 13. Do not use them to claim manifest coverage.

Run the inventory from this repository:

```sh
node scripts/audit-imports.mjs /path/to/tailwind-base/static > /tmp/imports.json
```

The script only reads files and invokes `git ls-files`. It emits scripts and
import edges with relative paths. It is a lexical inventory of one-line imports.
It does not resolve computed imports or prove that a runtime path is reachable.
Keep raw downstream inventories local. Review them before public use (R12.4).

## Reuse for 0.1

| Source | Reuse | Required boundary |
| --- | --- | --- |
| `lib/diff-regions.js` | Region extraction and its tests | Preserve screenshot-pixel units. Keep the algorithm pure. |
| `lib/runs-store.js` | Run-id grammar and completion handling | Separate parsing from filesystem access. Validate paths before access. |
| `lib/capture-scoped.js` | Selector, union and content-box capture | Use explicit options. Replace client examples with synthetic tests. |
| `lib/settle-lazy-images.js` | Lazy-image settlement | Make settlement explicit in each side recipe. |
| `lib/select-labels.js` | Selection semantics and tests | Use target IDs. Keep variant and page distinctions. |
| `visual/compare-target.js` | Image padding and pixelmatch procedure | Extract the operation. Do not import the executable runner. |

The old diff pads both images to the maximum width and height. It uses
pixelmatch with threshold `0.1`. It extracts regions from that diff buffer.
Retain the original dimensions and device scale factor in the result.
Do not treat the padded dimensions as the size of either original image.

The scoped capture helper contains important fixes. A union can extend below
the viewport. In that case it converts viewport coordinates to document
coordinates and uses `fullPage`. Content-box capture excludes padding and
border. Preserve these behaviors with synthetic browser tests before porting
them. Existing comments contain client examples. Do not copy those comments.

`viewports.js` reads a module-relative YAML manifest and imports Playwright
devices. Reuse its validation intent, but inject project configuration. A
package module must not resolve the project manifest relative to itself.
`base-url.js` contains project and DDEV discovery. The first release can use an
explicit local origin. Keep implicit CMS discovery out of the capture engine.

## Shared helper consumers

The visual area imports these helpers:

```text
base-url, capture-scoped, component-catalogue, coverage-verdict, diff-regions,
page-selectors, page-web-urls, runs-store, scope-estimate, select-labels,
settle-container-fs, settle-lazy-images, viewports, visual-run-rows
```

The behavior area also imports `base-url`, `viewports`, `runs-store`,
`scope-estimate` and `coverage-verdict`. Its own consumers need
`behavior-scope`, `behavior-listing`, `behavior-run-rows`, `behavior-render`,
`behavior-filters`, `behavior-projects`, `force-interaction-state` and
`settle-motion`. Cross-engine tests import `fluid-tokens` and `viewports`.
Fixture tests import `fixture-expectations`.

The inspected ESLint and Stylelint rule modules have no imports from
`tests/lib`. This does not make the whole library removable.
`lib/fluid-spans.test.js` checks project CSS tokens related to the Stylelint
length-division rule. `fixture-expectations.js` counts lint fixture findings.
Other
library tests read template files and component metadata.
Keep those tests and their input files during a visual move (R13.11).
Component behavior specs use the `#tests/behavior-spec.js` import alias.
Retain that seam until the behavior migration supplies a replacement.

## CMS command seams

Both inspected CMS skeletons declare Node `>=22` and the import mapping
`#tests/*` to `./tests/lib/*`. Both expose the same core command shapes:

| Command | Current implementation |
| --- | --- |
| `test:visual` | Playwright with `tests/visual/playwright.config.js` |
| `test:visual:update` | The same suite with `--update-snapshots` |
| `visual:harvest` | `tests/visual/harvest-targets.js` |
| `visual:compare` | `tests/visual/compare-target.js` |
| `visual:report` | `tests/visual/build-report.js` |
| `visual:changed` | `tests/visual/visual-changed.js` |
| `test:behavior` | Playwright with `tests/behavior/playwright.config.js` |
| `lint:js` | ESLint over source and template modules |
| `lint:css` | Stylelint over source and template styles |

The WordPress skeleton also exposes `test:behavior:engines`. Do not remove
that command as a side effect of a Chromium visual migration.

The canonical theme has project-local `eslint.config.js` and `.stylelintrc.cjs`.
They extend synced canonical configurations. A later lint entry point must
retain local overrides and the `portadesign` rule namespace (R13.40, R13.43).
Do not move project contracts or allowlists into package defaults.

Version 0.1 installs beside the old tool. It accepts explicit list targets and
local origins. It leaves old scripts, manifests, snapshots and aliases alone.
Version 0.2 replaces the old entry points with thin aliases. Before that move,
verify CLI arguments, exit codes, relative paths, selection semantics and
snapshot-update behavior on both skeletons. Update `verify-skeleton` and
`sync-skeleton` in the same migration (R13.10).

## Legacy report mapping

`build-report.js` groups metrics by target kind and ID. It orders viewports from
the manifest. It distinguishes page PNG names from component PNG names.
Its report contains `ratio`, `target`, `render`, `overflow`, `error`,
`selectorMissing`, `shots` and `capturedAt` per viewport.

The adapter must preserve those fields (R9.1). `shots.target` and `shots.render`
map to A and B only when a real comparison exists. An error row has no shots.
A render-only row has only a render shot. Do not revive stale image files from
an earlier comparison. Missing ratios must stay missing.
The report also carries component composition, rules and explanatory notes.
Do not discard them when adapting schema version 1.

The old runner folds partial runs into an aggregate report. Version 0.1 compares
two explicit immutable runs instead. Do not reuse aggregate folding for a pair:
it can mix measurements from different capture times.

## Verification and release gates

Measured on 2026-10-09: the existing `diff-regions`, `runs-store` and
`select-labels` unit suites pass all 28 tests. The audit does not run a browser.
This is evidence for reuse, not proof of package integration.

Before 0.1 release, verify:

1. A synthetic unchanged pair and an intentional changed pair.
2. A missing selector, failed navigation and incomplete run. Each stays visible.
3. Unequal image dimensions and device scale factors. Units remain explicit.
4. A region at the image edge and a component taller than the viewport.
5. A synthetic legacy report through the adapter. No field disappears.
6. Viewer and `summary` classifications for the same pair (R11.6).
7. Git-tag installation in DDEV with no package build step (R13.24–R13.30).
8. A local CMS pilot. Keep its config, output and screenshots outside git.

Do not rewrite the behavior engine, lint rules or cross-engine checks for 0.1.
They have separate migration work. The package's new capture and compare
boundaries require new orchestration, but not a new pixel-region algorithm.
