# Migration guide: a project that pins an old version

Status: draft. It serves issue #105 and vision open decision 9. Every consumer step below is not verified. The author had no access to a consuming project. Only this repository was read.

The guide is for a project that pins an old `@parisek/test-kit` and moves once onto the frozen seam ([seam.md](seam.md)). The vision names `tailwind-base` as the first such project. Its pin is `v0.2.1` (`docs/vision.md`, End state). The text uses `v0.2.1` as the worked example.

Move once, after the owner tags the 1.0 release candidate. Before that tag a break costs nothing, so a move earlier may need a second move. No release candidate tag exists yet.

## What the move covers

Two different moves share the word "migration". Keep them apart.

1. The package pin moves from an old tag to the release candidate. This guide covers it in full. Not verified.
2. The project's own testing files move into the package (R13.9 to R13.11, R13.43). This is a plan. Much of it is not possible yet. See "What stays blocked". Not verified.

## Part 1: move the pin

Measured with `git diff v0.2.1 origin/main` on 2026-10-19. The changes that reach a project are additive and non-breaking. The repository also changed outside the project interface (`package.json`, `package-lock.json`, CI and release workflows, `AGENTS.md`, `RELEASING.md`, documents).

| Area | Change since v0.2.1 |
| --- | --- |
| Configuration keys to rename | None. |
| Configuration keys to remove | None. |
| Configuration keys to add | None are required. Optional: `sides.<id>.remote` (0.5.0), `behavior.enabled` (0.3.0). |
| Configuration rules that relaxed | `runsRoot` now accepts a dot inside a segment (for example `.test-kit`). `.` and `..` segments still fail. |
| Commands removed or renamed | None. |
| Commands added | `run`, `before`, `after`, `report`, `history` (0.3.0, 0.4.0). |
| Flags added | `perf --path`, `--ddev`, `--store`; `perf --targets` is now optional when `--path` is set; `--checks none` for `run`, `before`, `after`. |
| Exports added | `./packs`, `./packs/a11y`, `./packs/a11y/runner`, `./packs/swiper`, `./packs/lint`, `./packs/lint/runner`. |
| Peer dependencies added | `axe-core`, optional. |
| Report version | Still 2. A move to 3 is planned ([seam.md](seam.md), section 6). |

Steps:

1. Read [seam.md](seam.md). Check that the project uses only frozen or experimental items. Mark any use of an item that is "not frozen". Not verified.
2. Install the exact tag (R13.27): `npm install -D github:parisek/test-kit#<tag>`. Replace `<tag>` with the release candidate tag. The lockfile records the commit. Not verified.
3. Install the browser peer: `npm install -D @playwright/test` and `npx playwright install chromium`. Add `lighthouse` only if the project runs `perf`. Not verified.
4. Leave `test-kit.config.json` unchanged. If the project has none, copy `node_modules/@parisek/test-kit/templates/test-kit.config.json` by hand. `test-kit init` does not exist. Not verified.
5. Keep the project aliases. Command names and required flags do not change in the frozen set. Not verified.
6. Capture new runs after the move. Compare runs from one package version with each other. R8.9 rejects a comparison across incompatible tool versions. Not verified: whether a change of the package version makes an old run incompatible.

## Part 2: files that move into the package

The plan is in specification section 13 (the "Scope over time" table) and in `docs/migration-audit.md`. It names these areas of `static/tests/`: `visual`, `behavior`, `lib`, `cross-engine`, `browser-support`, `eslint`, `stylelint`, `twig-cs-fixer`, `phpstan` (specification section 13, "Scope over time"). `visual` moves first. `behavior` moves as the engine, and project contracts stay. `lib` moves only for helpers that the moved areas use. `cross-engine` and `browser-support` move after `behavior`. `eslint` and `stylelint` move as entry points of this package (R13.40). `twig-cs-fixer` and `phpstan` go to `lint-kit`, not here.

Size. `docs/vision.md` (End state) records 414 files in the moved areas of `tailwind-base` `static/tests/` on 2026-10-16: visual 293 including baselines, behavior 44, lib 46, eslint 17, stylelint 14. The author did not reproduce this number. `docs/migration-audit.md` counts differently (visual 15, behavior 22, a source-tree count of 2026-10-09 without baselines). Do not mix the two.

What a project adds:

- The pinned dependency from Part 1 (R13.10 replaces the manifest entries of moved files with one dependency).
- `test-kit.config.json`.
- Thin aliases that call `test-kit` (R13.7). The mapping from each old script to a command is not written in this repository.

What a project keeps (R13.1, R13.43):

- Project contracts under `contracts/project/` and `tests/behavior/project/`.
- `eslint.config.js` and `.stylelintrc.cjs` with local overrides.
- The doctrine file `visual-comparison.md` and a configuration stub (R13.7).
- Helpers that a remaining lint test still imports (R13.11).

What a project updates in its own tooling: `verify-skeleton` and `sync-skeleton` must know the new state before a move merges (R13.10). Not verified here. Those scripts are outside this repository.

## What stays blocked

These need an owner decision or code that does not exist. The guide cannot give a step.

| Need | Why it is blocked |
| --- | --- |
| Replace the old visual scripts (`test:visual`, `visual:harvest`, `visual:compare`, `visual:report`, `visual:changed`) | `CHANGELOG.md` 0.2.0 says legacy command replacement is open. The alias mapping is not written. |
| Replace the shared behavior contracts (`picture`, `gsap`, `lightgallery`, `header-*`, `cookieconsent`, `hygiene`, `render-integrity`) | R13.42 plans packs. Only `swiper` and the axe pack exist. The browser step for `swiper` is not built. |
| Replace `lint:js` and `lint:css` | The lint pack reads the output of the project's own linters. The rules stay in the project. Specification section 17, item 7 is open. |
| Select a pack by configuration | No configuration key exists. A project selects a pack in code. |
| Keep an allowlist of accepted findings | The allowlist is not specified (ADR 0004, open question 4). |
| Set a default check set | Open (specification section 17, item 2). |

## Verification checklist

All items are not run. The author cannot run them in the consuming project. Run them in the project theme directory. Run Chromium capture on the host.

| # | Command | Expected result | State |
| --- | --- | --- | --- |
| 1 | `npx test-kit --version` | The installed version. Exit 0. | Not run |
| 2 | `npx test-kit --help` | The usage text, with the twelve commands of [seam.md](seam.md) section 3. Exit 0. | Not run |
| 3 | `node -e "import('@parisek/test-kit').then(m => console.log(Object.keys(m).join(' ')))"` | The names of the root export. | Not run |
| 4 | `npx test-kit capture --config test-kit.config.json --side local --label before` | One JSON line with `id`, `state`, `manifestPath`. Exit 0 when `state` is `complete`. Exit 1 otherwise. | Not run |
| 5 | `npx test-kit capture --config test-kit.config.json --side local --label after` | Same as 4. | Not run |
| 6 | `npx test-kit diff <run-a> <run-b> --output tests/visual/report` | One JSON line with `reportPath`. Exit 0. | Not run |
| 7 | `npx test-kit summary tests/visual/report/report.json --filter unexplained --max-targets 20` | One JSON line. Read the unexplained targets. | Not run |
| 8 | `npx test-kit serve tests/visual/report/report.json` | One JSON line with a loopback `url`. Stop the server after review. | Not run |
| 9 | The project's existing alias for the old command, after it calls `test-kit` | The same exit code and the same selection of targets as before. | Not run, and no mapping exists |
| 10 | `npm ls @parisek/test-kit` | Shows the exact tag or commit. | Not run |

A pass of items 1 to 8 shows that the pin, the CLI and the configuration work. It does not show that the project's behavior or lint coverage is complete. A matching screenshot can have an HTTP error. Read the availability field (R6.1).
