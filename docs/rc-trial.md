# Trial guide for the 1.0.0 release candidate

Status: written on 2026-10-19 for `v1.0.0-rc.1`. The owner tags the candidate. Until the tag exists, use the commit form in step 1.
The goal: you try the candidate on one real project, then you tell us if it meets your expectations. The checklist is at the end.
Use `example-site` in anything you paste into an issue (R12.4). This repository is public.

## What you can and cannot try

Measured on 2026-10-19 with a packed copy of this branch in a clean project. The browser was Chromium from Playwright. The sites were two local static pages.

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
npm install -D github:parisek/test-kit#v1.0.0-rc.1
npm install -D @playwright/test@1.64.0
npx playwright install chromium
```

Before the tag exists, pin the commit of the pull request merge instead: `npm install -D github:parisek/test-kit#<commit>`.

Check it:

```sh
npx test-kit --version   # 1.0.0
npx test-kit --help
```

Notes:

- Node 20 or newer (`engines`).
- `@playwright/test` is a peer dependency (`>=1.49`). `capture` and `run` need it and a browser. See [Playwright browsers](https://playwright.dev/docs/browsers).
- `axe-core` (`^4.10.0`) is an optional peer. Install it only for the a11y runner. `lighthouse` is an optional peer for `perf`.
- Verified: `npm install -D github:parisek/test-kit#<commit>` installs this package from GitHub into a clean project, and `--version` prints `1.0.0`. Not verified: the form with the tag `#v1.0.0-rc.1`, because the tag does not exist yet. A tag ref uses the same npm syntax as a commit ref. R13.27 gives the same form.

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

Keep `artifacts` in the file. Without it, `run`, `before` and `after` stop with "Unknown suite" (see "Known gaps"). `capture` works without it.
The shipped example is `node_modules/@parisek/test-kit/templates/test-kit.config.json`. The full key list is in `docs/seam.md`, section 1.

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

Every command prints one line of JSON with the run IDs and paths. Use those in the next command. `diff` and `summary` need run IDs from the `capture` output.
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

- `summary`: `verdict` and `counts`. One changed page gives `unexplained`. An unchanged page gives `match`.
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
| Process documents have wording nits and open questions marked unverified. | [#122](https://github.com/parisek/test-kit/issues/122) | None. It concerns the release process, not the product. |
| `run`, `before` and `after` stop with "Unknown suite" when the configuration has no `artifacts` key. `capture` and `diff` do not. Found while writing this guide, in `src/workflow/selection.js`: the suite `all` reads the raw `artifacts` list. No issue exists yet. | This guide | Keep `artifacts` in the file. |
| The report is `schemaVersion` 2. Version 3 (`pair` optional, single-run results) is planned. | `CHANGELOG.md`, Unreleased, Migration | Pack findings do not reach the report. |
| Open design questions: the default set of checks, retention of snapshots, the allowlist file, selection per target, the lint config seam, pack versioning, options for a pack. | `docs/seam.md` section 7 | Tell us what you need. |

## 7. Decisions already closed

You do not need to answer these. They are decided.

- Result model: option C of [ADR 0004](adr/0004-result-model.md), each check has a basis (vision, open decision 1).
- Only the owner tags a stable release. The agent tags dev versions only (decision 2; R13.25).
- Milestone work merges into `main` (decision 8).
- The project-facing seam freezes at the first release candidate (decision 9; `docs/seam.md`).
- The package adds no guard for sites you do not own (decision 11).
- Accessibility and component packs live in the package as opt-in entry points (specification section 17, item 6; R13.42).
- Packs are selected by the `packs` key, IDs only (R13.44).
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
