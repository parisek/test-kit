# Migration guide: a project that pins an old version

Status: draft. It serves issue #105 and vision open decision 9. The author had no access to a consuming project. Only this repository was read. A pilot in one consumer project added the checks described below.

One consumer project ran part of this guide once, on 2026-10-19, against a local site, with `v1.0.0-rc.2`. Part 1 steps 1 to 6 and checklist items 1 to 8 and 10 ran. Where a step or an item says "Verified once", it means that run and no other. It is one project and one local site. It is not a general result. Everything else stays "Not verified". In that run these parts did not run: checklist item 9 (the mapping of an old alias), `perf`, a remote side, the `packs` key with a pack ID, and the viewer in a browser.

A second run on 2026-10-23 used the same project and the same local site, with test-kit commit `5ecf7b1` (after `v1.0.0-rc.3`). It ran `before` and `after` with `--ddev`, `perf` with `--ddev`, the `packs` key with a pack ID, and the published viewer in Chromium. Results are in issue #136. Where a step says "Verified on 2026-10-23", it means that run and no other. Still not run: checklist item 9 and a remote side.

A third run on 2026-10-24 used the tag `v1.0.0-rc.4` through the pilot pull request. It ran `before` and `after` with `--ddev` around one template change, then `history --publish`, and opened the viewer in Chromium. Results are in issue #106.

The guide is for a project that pins an old `@parisek/test-kit` and moves once onto the frozen seam ([seam.md](seam.md)). The vision names `tailwind-base` as the first such project. Its pin is `v0.2.1` (`docs/vision.md`, End state). The text uses `v0.2.1` as the worked example.

Move once, onto a release candidate tag. The tags `v1.0.0-rc.1` to `v1.0.0-rc.4` exist. Use the newest one. [rc-trial.md](rc-trial.md) says how to tell a candidate from a stable 1.0.0. A candidate is not the stable release: the owner has not tagged 1.0.0. A later candidate may need a second move.

## What the move covers

Two different moves share the word "migration". Keep them apart.

1. The package pin moves from an old tag to the release candidate. This guide covers it in full. Part 1 is verified once (see the status above).
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

1. Read [seam.md](seam.md). Check that the project uses only frozen or experimental items. Mark any use of an item that is "not frozen". Verified once.
2. Install the exact tag (R13.27): `npm install -D github:parisek/test-kit#<tag>`. Replace `<tag>` with the release candidate tag. The lockfile records the commit. Verified once.

   Note: One consumer project saw this once, with npm 11.19 and 11.20. `package-lock.json` held a `git+ssh://git@github.com/...` URL for this dependency. The spec was `git+https`. This is npm behaviour, not a choice of this package. A project whose rules require HTTPS can set the `resolved` scheme to `git+https://github.com/parisek/test-kit.git#<commit>` by hand. Then install with `npm ci`. Verified once on one consumer project on 2026-10-19: `GIT_SSH_COMMAND=false npm ci` in a clean cache installs and leaves the lockfile unchanged, and `npm ls` shows the https URL. `npm ci`, `npm ls` and `npx test-kit --version` leave the scheme alone. `npm install` and `npm install --package-lock-only` write `git+ssh://` back (measured on a copy). One project script that runs npm commands also rewrote it, and the cause is not found. Run `git diff package-lock.json` before every commit.
3. Install the browser peer: `npm install -D @playwright/test` and `npx playwright install chromium`. Add `lighthouse` only if the project runs `perf`. Verified once for `@playwright/test`, with version 1.63.0. The peer range is `>=1.49`. The version that `docs/rc-trial.md` names is the one CI uses, not a requirement. Verified on 2026-10-23 for `perf`: with `lighthouse` 13.5.0, `perf --side local --targets <id> --ddev --runs 3` measured the loopback HTTP origin and exited 0. Without the `lighthouse` peer, `perf` stops with "Install the optional lighthouse peer before performance capture." and exit code 1. On a busy machine `perf` stops with "Machine load is high." and exit code 1. `--allow-high-load` runs it anyway, and the results are then less stable. In that run `lighthouse` came from a separate install, not from the project's lockfile. Not verified: `npm install -D lighthouse` in the project.
4. Leave `test-kit.config.json` unchanged. If the project has none, copy `node_modules/@parisek/test-kit/templates/test-kit.config.json` by hand. `test-kit init` does not exist. Verified once: a configuration without the `packs` key loads. The load showed no rejected key and no peer warning. Verified on 2026-10-23: `"packs": ["a11y"]` loads, `run.json` records it, and the `settingsHash` is the same as without the key. An unknown ID stops the run with "Invalid configuration: unknown pack (known: a11y, lint, swiper)" and exit code 1. No command runs the selected packs yet (see "What stays blocked").
5. Keep the project aliases. Command names and required flags do not change in the frozen set. Verified once for the commands. Not verified: the mapping of an old alias (checklist item 9).
6. Capture new runs after the move. This is cautious advice, not a rule. Old runs still compare with new runs when the settings and the tool versions match.

   What the code does is below. Sources: `src/capture/index.js`, `src/compare/runs.js` and `src/config/settings.js`. The hash code is the same in `v0.2.1` and in `v1.0.0-rc.2`. The browser settings are the same too.

   - A run does not record the package version. `run.json` `tools` lists `playwright` and `chromium`, each with a version. It adds one entry for each artifact other than the screenshot (`html`, `status` and others). The behavior artifact records the constant `BEHAVIOR_VERSION`. It does not record the package version.
   - A comparison tests two things (R8.9).
   - The two `settingsHash` values must be equal.
   - The `tools` entries for Playwright and Chromium must be equal in name, version and hash. These are the entries with no artifact or with the screenshot.
   - A mismatch gives `incompatible`.
   - The hash covers the viewports, the `settle` recipe of the side, the screenshot settings, the browser settings and, for the behavior artifact, the contract fingerprint. It does not cover the `packs` key or the origin.
   - So a change of the package version does not make an old run incompatible. A change of the Playwright or Chromium version does. A change of the capture settings does.
   - Verified once: runs from `v0.2.1` and from `v1.0.0-rc.2` had the same `settingsHash` and compared with `incompatible: 0`. The only stored difference was an added `"packs": []`, which the hash ignores.
   - If the move also moves Playwright or its Chromium, expect `incompatible` for old runs. Capture new ones.
7. Open the published viewer. `test-kit history --config test-kit.config.json --publish <dir>` writes the viewer and the data under the site root. Verified on 2026-10-23 in Chromium: the list of comparisons, one report and its screenshot evidence opened.

   Note: Two problems showed in that run.

   - With DDEV and Mutagen, the new `reports/<id>/` directory did not reach the web container after a publish. The site then served a web page for `report.json`, and the viewer said "the server returned a web page, not JSON". `ddev mutagen sync` fixed it. Run it after each publish.
   - The site sent long cache times for static files. A reload showed the old list of comparisons. Issue #209 changes the viewer to revalidate its JSON files. The viewer files `app.js` and `style.css` keep fixed names, so a browser can keep an old viewer after an upgrade. Reload without the cache once after an upgrade.

   Serve the publish directory without a long cache (issue #217). The viewer keeps fixed file names (`index.html`, `app.js`, `style.css`, `index.json`). A long cache on any of them shows an old viewer or an old list after a publish or an upgrade. The package does not write a server file. The project configures its server. In `tailwind-base`, `static/.htaccess` sets a two-week `ExpiresDefault` for every file. A rule for the publish path turns it off:

   ```apache
   <If "%{REQUEST_URI} =~ m#^/styleguide/test-kit/#">
     <IfModule mod_expires.c>
     ExpiresActive Off
     </IfModule>
     <IfModule mod_headers.c>
     Header set Cache-Control "no-cache"
     </IfModule>
   </If>
   ```

   Put it after the `mod_expires` block. Change the path when the project publishes to another directory. Verified on 2026-10-24 on the local DDEV site (Apache): `index.html`, `app.js`, `style.css`, `index.json` and a `report.json` sent `cache-control: no-cache`, and `dist/css` kept `max-age=1209600`. The viewer opened in Chromium with no script error. A project on nginx needs its own rule. That is not verified.

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
| Replace `lint:js` and `lint:css` | The lint pack reads the output of the project's own linters. The rules stay in the project. The entry points of specification section 17, item 7 are decided but not built yet (#105). |
| Select a pack by configuration | The `packs` configuration key lists built-in pack IDs (R13.44). No command runs the selected packs yet. A project can also select a pack in code with `resolveChecks`. |
| Keep an allowlist of accepted findings | The allowlist is not specified (ADR 0004, open question 4). |
| Set a default check set | Decided: no check runs by default (specification section 17, item 2). Select checks with `checks`. |

## Verification checklist

Items 1 to 8 and 10 are "Verified once": one consumer project ran them on 2026-10-19 against a local site, with `v1.0.0-rc.2`. Item 9 did not run. Run them in the project theme directory. Run Chromium capture on the host.

The report path `tests/visual/report` in items 6 to 8 is only an example. In one consumer project it is the folder of the legacy visual suite. The report path is free: use any relative path.

| # | Command | Expected result | State |
| --- | --- | --- | --- |
| 1 | `npx test-kit --version` | The installed version. Exit 0. | Verified once |
| 2 | `npx test-kit --help` | The usage text, with the twelve commands of [seam.md](seam.md) section 3. Exit 0. | Verified once |
| 3 | `node -e "import('@parisek/test-kit').then(m => console.log(Object.keys(m).join(' ')))"` | The names of the root export. | Verified once |
| 4 | `npx test-kit capture --config test-kit.config.json --side local --label before` | One JSON line with `id`, `state`, `manifestPath`. Exit 0 when `state` is `complete`. Exit 1 otherwise. | Verified once |
| 5 | `npx test-kit capture --config test-kit.config.json --side local --label after` | Same as 4. | Verified once |
| 6 | `npx test-kit diff <run-a> <run-b> --output tests/visual/report` | One JSON line with `reportPath`. Exit 0. | Verified once |
| 7 | `npx test-kit summary tests/visual/report/report.json --filter unexplained --max-targets 20` | One JSON line. Read the unexplained targets. | Verified once |
| 8 | `npx test-kit serve tests/visual/report/report.json` | One JSON line with a loopback `url`. Stop the server after review. | Verified once |
| 9 | The project's existing alias for the old command, after it calls `test-kit` | The same exit code and the same selection of targets as before. | Not run, and no mapping exists |
| 10 | `npm ls @parisek/test-kit` | Shows the exact tag or commit. | Verified once |

A pass of items 1 to 8 shows that the pin, the CLI and the configuration work. It does not show that the project's behavior or lint coverage is complete. A matching screenshot can have an HTTP error. Read the availability field (R6.1).
