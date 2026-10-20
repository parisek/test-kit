# Trial guide for the 1.0.0 release candidate

Status: updated on 2026-10-20 for `v1.0.0-rc.3`, the current candidate.
The tag `v1.0.0-rc.1` is the first candidate. It stays as history.
The owner tags the candidate on the squash commit of the merged pull request on `main`.
The tag form `-rc.N` is defined by R13.45, and `release.yml` accepts rc tags.
The workflow checks that the tag equals `v` plus `package.json` version plus `-rc.N`, and that the commit is on `main`.
Use the tag form in step 1. The commit form still works.
The goal: you try the candidate on one real project, then you tell us if it meets your expectations. The checklist is at the end.
Use `example-site` in anything you paste into an issue (R12.4). This repository is public.

## What you can and cannot try

Measured on 2026-10-19 with a packed copy of this branch in a clean project, before `history --publish` existed. This check does not cover `history --publish`. The browser was Chromium from Playwright. The sites were two local static pages.

| You can try | State |
| --- | --- |
| Install, `--help`, `--version` | Verified |
| `capture`, `diff`, `summary`, `serve`, `query` on two local sides | Verified (`serve` answered HTTP 200; the viewer was not opened) |
| `before`, `after`, `report` (served, HTTP 200), `report --export`, `history --export` | Verified |
| `packs` key in the configuration: `["a11y"]` is accepted, an unknown ID fails | Verified |
| The accessibility pack from a Node script (`runAxe` on a Playwright page) | Verified. Without `axe-core` the result is `missing`. With it the result is `complete`, and a missing `alt` gives an `error` finding |
| The `lint` pack runner and the Swiper pack | Not run in this check |
| Remote side, `perf`, `record-known`, DDEV | Not run in this check |

| You cannot try yet | Why |
| --- | --- |
| Run a selected pack from the command line | No command reads the `packs` key. The key is validated and ignored. A report from a project with `"packs": ["a11y"]` has no a11y data. |
| A pack finding in the report or the viewer | The report is `schemaVersion` 2. Single-run results need `schemaVersion` 3. |
| `test-kit init` | It does not exist and will not be built (owner decision, 2026-10-19). Copy the template by hand. |
| The Swiper pack on a live page | No browser step collects the DOM facts or the library version (#104, #121). |
| Options for a pack | The `packs` key takes IDs only. |

## 1. Install

The package is not on an npm registry (specification section 13.2). A project installs it from a git tag and pins it exactly (R13.27).

```sh
npm install -D github:parisek/test-kit#v1.0.0-rc.3
npm install -D @playwright/test@1.64.1
npx playwright install chromium
```

You can pin a commit instead of the tag: `npm install -D github:parisek/test-kit#<commit>`.

One consumer project saw this once, with npm 11.19 and 11.20. `package-lock.json` held a `git+ssh://git@github.com/...` URL for this dependency. The spec was `git+https`. This is npm behaviour, not a choice of this package. A project whose rules require HTTPS can set the `resolved` scheme to `git+https://github.com/parisek/test-kit.git#<commit>` by hand. Then install with `npm ci`. Verified once on one consumer project on 2026-10-19: `GIT_SSH_COMMAND=false npm ci` in a clean cache installs and leaves the lockfile unchanged, and `npm ls` shows the https URL. `npm ci`, `npm ls` and `npx test-kit --version` leave the scheme alone. `npm install` and `npm install --package-lock-only` write `git+ssh://` back (measured on a copy). One project script that runs npm commands also rewrote it, and the cause is not found. Run `git diff package-lock.json` before every commit.

`@playwright/test@1.64.1` is the version that CI uses and the tested one. It is not a requirement. The peer range is `>=1.49`. One consumer project ran `1.63.0` without a problem.

Check it:

```sh
npx test-kit --version   # 1.0.0
npx test-kit --help
```

`--version` prints `1.0.0` for a candidate too. It reads `package.json`, and the candidate keeps the version `1.0.0`. So the output does not tell a candidate from a stable 1.0.0. To tell them apart, run `npm ls @parisek/test-kit`, which shows the git commit, and read the commit in `package-lock.json`. Compare it with the commit of the tag `v1.0.0-rc.3` (`git rev-parse v1.0.0-rc.3^{commit}` in a clone of this repository).

Notes:

- Node 20 or newer (`engines`).
- `@playwright/test` is a peer dependency (`>=1.49`). `capture` and `run` need it and a browser. See [Playwright browsers](https://playwright.dev/docs/browsers).
- `axe-core` (`^4.10.0`) is an optional peer. Install it only for the a11y runner. `lighthouse` is an optional peer for `perf`.
- Verified: `npm install -D github:parisek/test-kit#<commit>` installs this package from GitHub into a clean project, and `--version` prints `1.0.0`. Verified once on one consumer project on 2026-10-19 against a local site: the form with the tag `#v1.0.0-rc.2`, then the steps in section 3 and the exports. Not run there: a remote side, `perf`, the `packs` key with a pack ID and the viewer in a browser. A tag ref uses the same npm syntax as a commit ref. R13.27 gives the same form.

## 2. Minimal configuration for a first run

Create `test-kit.config.json` in the project directory. The loader reads JSON only. Replace the origins with your local site (before) and, for a comparison of two states, a second origin.

```json
{
  "schemaVersion": 1,
  "sides": {
    "local": { "origin": "http://localhost:8080" }
  },
  "targets": [{ "id": "home", "kind": "page", "title": "Home", "path": "/" }],
  "viewports": [{ "id": "desktop", "width": 1280, "height": 800 }],
  "artifacts": ["screenshot", "html", "status"]
}
```

The `artifacts` key is optional. Without it the default is `["screenshot"]` (R5.1). Add `html` and `status` to see the HTML diff and the HTTP status. The example above lists them.
The shipped example is `node_modules/@parisek/test-kit/templates/test-kit.config.json`. The full key list is in [`docs/seam.md`](https://github.com/parisek/test-kit/blob/main/docs/seam.md), section 1. The `docs/` folder is in the repository, not in the installed package.

## 3. First run

Compare a site before and after a change:

```sh
npx test-kit before --side local     # baseline
# change your code
npx test-kit after --side local      # compares with the baseline, writes a report
npx test-kit report                  # serves the viewer on loopback; open the printed url
```

The same flow with the low-level commands:

```sh
npx test-kit capture --side local --label before
# change your code
npx test-kit capture --side local --label after
npx test-kit diff <run-a> <run-b> --output tests/visual/report
npx test-kit summary tests/visual/report/report.json --filter all
npx test-kit serve tests/visual/report/report.json
```

To browse without the package server, publish a stable directory and open it from any static host (R10.12, R10.13):

```sh
npx test-kit history --publish test-kit-local/site
cd test-kit-local/site && python3 -m http.server --bind 127.0.0.1
```

The viewer lists the reports and runs from `index.json`. A `file://` URL does not work. Add `test-kit-local/` and the three `.test-kit-lock`, `.test-kit-new` and `.test-kit-old` siblings to `.gitignore`. The directory contains captured pages. Measured once on one consumer project on 2026-10-20 with a build of `main` before the `rc.3` tag: the list and one report opened in Chromium. Not verified: a remote side, a project web server rule, and the `#r-<id>` anchor on first load.

The report path is free: use any relative path. `tests/visual/report` is only an example. A project may already use that folder for another tool.

Measured on one local page, not a rule: an image with `loading="lazy"` that fails with an HTTP error (404) made `before` return state `partial` with `baselineUpdated: false`. The same image without `loading="lazy"` did not: the state was `complete`. If `before` returns `partial`, check the broken assets on the page.

Every command prints one line of JSON with IDs and paths. `diff` needs the two run IDs from the `capture` output. `summary`, `serve` and `query` need the report path that `diff` prints (`reportPath`).
Two different origins also work: put two sides in the file, capture each, then `diff` the two runs.

## 4. Enable a pack with the `packs` key

```json
"packs": ["a11y"]
```

Valid IDs: `a11y`, `lint`, `swiper`. No duplicates. No options. A wrong ID fails at load: `Invalid configuration: unknown pack (known: a11y, lint, swiper)`.

Today this key only validates. No command runs the pack. To use the accessibility pack, run it from a Node script. Install `axe-core` first:

```sh
npm install -D axe-core@^4.10.0
```

```js
import { chromium } from '@playwright/test';
import { resolveChecks, runChecks } from '@parisek/test-kit/packs';
import { a11yPack } from '@parisek/test-kit/packs/a11y';
import { runAxe } from '@parisek/test-kit/packs/a11y/runner';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
const artifact = await runAxe(page, { tags: ['wcag2a', 'wcag2aa'] });
await browser.close();
const plan = resolveChecks({ available: [a11yPack], packs: ['a11y'] });
console.log(JSON.stringify(runChecks(plan, { artifact: 'a11y', value: artifact }, { targetId: 'home', viewportId: 'desktop' }), null, 2));
```

The result has `state` and `findings`. A finding has `severity`, `message` and `evidence` (selector, HTML, help URL). Automated rules find only part of the accessibility problems (`src/packs/a11y/README.md`).
The `lint` pack runner starts your own ESLint and Stylelint (`src/packs/lint/README.md`).

## 5. What to look at in the report

- `summary`: `verdict` and `counts`. On the two local pages I measured, a page with changed text gave `unexplained`, and two runs of an unchanged page gave `match`. This is not general: a known-difference rule can explain a change, and missing, failed, incompatible or unavailable evidence prevents `match` (R8.7).
- `states`: `complete`, `missing`, `failed`, `incompatible`. Fix `failed` and `missing` first. A matching picture with an HTTP error is still reported.
- The viewer: the screenshot pair, the HTML diff, the status. Check that the text is readable and that a changed target is easy to find.
- `query ... --artifact status` or `html`: a bounded window of evidence for an agent.
- Does the output fit your real site? Check the time of a run, the size of `.test-kit/`, and the count of targets you need.
- Does a stored run from one day work the next day?

## 6. Known gaps in this candidate

From `docs/seam.md`, section 8, and the open issues, read with `gh` on 2026-10-19. A gap is not a bug in the frozen seam. It is work that 1.0 does not include, or that you decide.

| Gap | Source | Effect on your trial |
| --- | --- | --- |
| No command runs a selected pack. No flag selects one. | `docs/seam.md` section 8, item 2 | You run packs from a script only. |
| The six built-in checks export no `basis`. R7.2 requires it. Deferred to `schemaVersion` 3 (decided). | `docs/seam.md` section 8, item 3 | None in the report. |
| No `init`. | `docs/seam.md` section 8, item 1 (decided) | Copy the template by hand. |
| A browser step that collects DOM facts and detects the library version does not exist. The Swiper pack cannot run on a live page from the package. | [#104](https://github.com/parisek/test-kit/issues/104), [#121](https://github.com/parisek/test-kit/issues/121) | You supply the facts yourself, or skip the Swiper pack. |
| Pack hardening: the snapshot walk stack is not bounded; the depth wording differs. Stored artifacts are JSON, so this is hardening only. | [#115](https://github.com/parisek/test-kit/issues/115) | None expected. |
| Axe pack tidy: README wording, `-0` in a tampered artifact, a page stays claimed after a timeout. Frame injection, per-state runs and allowlists are not built. | [#120](https://github.com/parisek/test-kit/issues/120) | Use a new page for each `runAxe` run. |
| Versioned contract sets: error wording, the Swiper walk stops at the first malformed instance. Loop mode, virtual slides and `swiper-element` are not covered. The Swiper 12 and 14 sets are identical. | [#121](https://github.com/parisek/test-kit/issues/121) | Swiper only. |
| Process documents (#109) have wording nits and open questions marked unverified (bot `author_association`, event names, tree comparison). Owner actions are open: the `merge-halt` label now exists; the main-protection ruleset does NOT exist yet, because the owner has not allowed creating it; the tag ruleset for `v*` is not confirmed. | [#122](https://github.com/parisek/test-kit/issues/122) | None for the trial. It concerns the release process, not the product. Without the ruleset, nothing blocks a merge on failed checks. |
| The report is `schemaVersion` 2. Version 3 (`pair` optional, single-run results) is planned. | `CHANGELOG.md`, `[1.0.0-rc.1]`, Migration | Pack findings do not reach the report. |
| Open design questions: the default set of checks, retention of snapshots, the allowlist file, selection per target, the lint config seam, pack versioning, options for a pack (section 1). | `docs/seam.md` sections 1 and 7 | Tell us what you need. |

## 7. Decisions already closed

You do not need to answer these. They are decided.

- Result model: option C of [ADR 0004](adr/0004-result-model.md), each check has a basis (vision, open decision 1).
- Only the owner tags a stable release. The agent tags dev versions only (decision 2; R13.25).
- Milestone work merges into `main` (decision 8).
- The project-facing seam freezes at the first release candidate (decision 9; `docs/seam.md`).
- The package adds no guard for sites you do not own (decision 11).
- Accessibility and component packs live in the package as opt-in entry points (specification section 17, item 6; R13.42).
- Packs are selected by the `packs` key, IDs only (R13.44).
- The rc tag form is `vMAJOR.MINOR.PATCH-rc.N`, for example `v1.0.0-rc.1` (R13.45, on `main`; only the owner tags it).
- Freeze scope: the pack API and the a11y pack are frozen. The lint pack is not (`docs/seam.md`, section 5).
- Process safeguards (#122): decided. The label `merge-halt` exists. The main-protection ruleset is NOT created yet.
- 2026-10-19: no `init`; an undecidable axe result stays `complete` with a `warning` (R8.14); `basis` waits for `schemaVersion` 3; the pack API and the a11y pack are frozen, the lint pack is not (`docs/seam.md`, sections 5 and 8).

Still open: options for a pack, running packs from the command line, and the browser step for DOM facts and library version (#104).

## 8. Feedback checklist

Answer in a comment on the pull request or in a new issue. Use `example-site` for any name.

What worked:

- [ ] The install worked in one try. Time taken: ___
- [ ] `before` and `after` (or `capture` and `diff`) ran on a real page.
- [ ] The report showed the change I made, and only that change.
- [ ] The viewer and `summary` answered "what changed" faster than my old way.
- [ ] The a11y script found a real problem, or a clean page stayed clean.

What was missing:

- [ ] A page or state I need that the targets cannot describe: ___
- [ ] A check, artifact or pack I expected: ___
- [ ] A command or flag I expected: ___
- [ ] Text in the guide or in an error message that I did not understand: ___

What blocks 1.0:

- [ ] A frozen item in `docs/seam.md` that I would change before it freezes: ___
- [ ] A step I could not do without help: ___
- [ ] A run that was too slow or too large: ___
- [ ] Running packs from the CLI must exist before 1.0: yes / no
- [ ] The browser step for DOM facts and library version (#104) must exist before 1.0: yes / no
- [ ] Options for a pack must exist before 1.0: yes / no

Overall: does the candidate meet your expectations? yes / partly / no. What would change the answer?
