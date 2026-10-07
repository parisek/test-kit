<!-- Source of truth while the issue is open: https://github.com/portadesign/tailwind-base/issues/873. Keep both in step. -->

A project compares two states of its site many times. Examples: before and after a dependency update, production against a local build, an old structure against a new one. Each project builds its own tool for this, and each copy drifts. The testing tools in this repository have the same problem: about 90 files in `static/tests/` are copied into every project and again into every skeleton.

This issue proposes one separate package, `parisek/test-kit`, public from the first commit. A project adds configuration and targets only. The tools move into the package in steps, one pull request each. The text below is the specification. A working viewer prototype exists (sample data only, 62 unit tests). The PHP lint rules are a separate issue: portadesign/tailwind-base#874 (`lint-kit`).

---

## 1. Purpose

A project changes while its public site must stay correct. Typical causes: a dependency update, a deploy, a migration
from an old structure to a new one, a performance task.

The tool answers one question: **what is different between side A and side B, and is each difference explained?**

It must work for pages and for components with the same viewer. It must give a person and an agent the same facts.

### Goals

- G1. One concept for every comparison: a **pair of runs** over a list of **targets**.
- G2. More than pictures: HTML, HTTP status, behaviour, content checks, speed.
- G3. Additive. Each artifact and each check is a file that a project switches on. Nothing new runs by default.
- G4. One viewer, one report format, one query interface for agents.
- G5. Local. Runs stay on the developer machine, outside git.

### Non-goals

- N1. No pass or fail gate by default. The pixel ratio is a compass, not a verdict.
- N2. No second browser engine. Chromium only.
- N3. No hosted service, no account, no upload.
- N4. No automatic fixing. The tool measures and reports.
- N5. No package outside `tailwind-base` yet. A package like `parisek/styleguide` is a later goal.

---

## 2. Glossary

| Term | Meaning |
| --- | --- |
| side | A source of pages: `local`, `production`, `styleguide`, `reference`. It has an origin and a settle recipe. |
| target | One thing to compare: a page path or a component. A path may differ per side. |
| run | One capture of one side. It has an id and lives in `tests/visual/runs/<id>/`. |
| pair | Two runs, A and B, compared. It has a **kind**. |
| artifact | A kind of evidence in a run: `screenshot`, `html`, `status`, `behavior`, `lighthouse`, `content`. |
| check | A small module that reads one artifact and reports findings (heading outline, language). |
| finding | One difference or defect on a target, in an artifact, optionally in a viewport. |
| cause | A named reason that explains findings. It may be known (accepted) or unknown. |
| class | `match`, `explained`, `unexplained`, `oracle`. Derived, never stored. |
| normaliser | A rule that removes a known environment difference before comparing. It has evidence. |
| noise floor | The difference between a side and itself. It sets the smallest meaningful change. |

---

## 3. Pair kinds

| Kind | A | B | Typical normalisers |
| --- | --- | --- | --- |
| `convergence` | reference site | styleguide | few |
| `self-baseline` | styleguide, earlier | styleguide, now | none |
| `update` | local, earlier | local, now | none |
| `migration` | production | local | environment rules |
| `deploy` | production, earlier | production, now | none |
| `adhoc` | any URL | any | by choice |

- R3.1 The pair kind must decide which normalisers apply and which view opens first.
- R3.2 A pair across two environments must not be used to judge speed (see R6.5).

---

## 4. Architecture

```
config (global)  ->  capture  ->  runs (local disk)  ->  compare  ->  report.json + sidecars
                                                                          |-> viewer (person)
                                                                          |-> query CLI (agent)
```

- R4.1 Capture and compare are two commands: `visual:capture --side <s> --label <l>` and `visual:diff <runA> <runB>`.
- R4.2 One page load must feed every artifact that the run asks for. Production gets one request per target, not one per artifact.
- R4.3 The old commands (`visual:harvest`, `visual:compare`, `test:visual`) stay as thin aliases. No project changes.
- R4.4 The pure logic (classification, scope of rules, adapters) must have no DOM dependency and must have unit tests.

---

## 5. Configuration (global)

One project file declares everything. A run copies the settings it used into itself, so an old run stays readable after the file changes.

```yaml
sides:     { local: {...}, production: {...}, styleguide: {...} }
targets:   { source: manifest | styleguide | list, ... }
viewports: from the viewport manifest
artifacts: [screenshot, html, status]          # default set; others on request
checks:    [heading-outline, lang, empty-alt]  # default set; others on request
budgets:   { /: { lcp_ms: 2500 } }             # speed limits per target
known_diffs: { <pair>: [ { target, cause, evidence } ] }   # belongs to a pair, not a side
```

- R5.1 The default set of artifacts and checks must be small. Everything else must need `--artifacts` or `--checks`.
- R5.2 `known_diffs` must belong to a pair. Turnstile and AVIF against WebP hold for `production` against `local` only.
- R5.3 Writing a `known_diffs` entry must be a command that records evidence. It must not be a viewer action.
- R5.4 Each side has a settle recipe (motion, masks, wait). The report must show the recipe, not hide it.

---

## 6. Artifacts

| Artifact | Holds | Compared by |
| --- | --- | --- |
| `screenshot` | PNG per viewport | pixel diff, regions in px with a unit |
| `html` | server response body (DOM after scripts: opt-in) | normalised line diff |
| `status` | final status, redirect target, asset counts | equality |
| `behavior` | steps, console, network, `dataLayer`, recordings | step by step list diff |
| `lighthouse` | speed metrics, full report kept locally | median and spread against the noise floor |
| `content` | extracted text, headings, language, links | checks (section 7) |

- R6.1 `status` is shown but is not counted in the class of a target.
- R6.2 A `behavior` step has: title, state (`same`, `changed`, `failed`), result A, result B, and evidence (screenshot, console, network, `dataLayer`, DOM).
- R6.3 A behaviour recording (trace, video) stays local. The viewer shows the command `npx playwright show-trace <path>`.
- R6.4 Every artifact must record the tool name, the tool version and a hash of the settings it used.

### Speed (`lighthouse`)

- R6.5 Speed must run only on request. A command that would run more than a few targets must state its cost and wait for consent.
- R6.6 Each target must run several times (3 to 5). The result is the median and the spread. One run proves nothing.
- R6.7 One discarded request must come before the measured runs, so run 1 does not measure a cold cache.
- R6.8 The runner must refuse to start under high machine load unless told otherwise. Such a run is marked suspect.
- R6.9 Throttling preset, form factor and run count must be fixed per run and stored in it. Two runs with a different hash must not be compared silently.
- R6.10 A pair of two environments must not be compared for speed. The viewer must say so instead of drawing a regression.
- R6.11 A budget breach is a finding. The exit code changes only with `--fail-on-budget`.
- R6.12 Raw Lighthouse JSON and HTML stay local under `runs/`. `report.json` does not carry them (section 9).

---

## 7. Checks

A check is one file. It reads an artifact and returns findings.

```js
// checks/heading-outline.mjs
export const id = 'heading-outline';
export const title = 'Heading outline';
export const applies = { artifacts: ['html'] };
export function check(doc, ctx) { return [ /* { target, severity, message, evidence } */ ]; }
```

- R7.1 A check must be a pure function of the stored artifact. A new check must run over an existing run without a new capture.
- R7.2 A check must export `id`, `title`, `applies` and `check`. A CLI entry, if any, must sit behind an `import.meta.url` guard.
- R7.3 Findings of a check go into the same `findings` list as findings of any artifact. Classes and rules apply with no special case.
- R7.4 A run stores the version of each extractor that read its content. Two runs with different extractor versions must not be compared silently.
- R7.5 Starter checks: heading outline (one `h1`, no skipped level), page language against the expected one, empty `title` and `alt`, broken internal links, text difference A against B.
- R7.6 A language-detection check needs a library. Add it only after a check of origin, releases and advisories.

---

## 8. Classification

Derived from findings and `matchBelow`. Never stored.

| Class | Meaning |
| --- | --- |
| `match` | no finding, ratio below `matchBelow` |
| `explained` | every finding has a known cause |
| `unexplained` | at least one finding with no known cause |
| `oracle` | the target judges by a rule, not by ratio (`judge: oracle`). Never coloured by ratio. |

- R8.1 The default `matchBelow` is 3 percent. It is a compass. The report must not call it a verdict.
- R8.2 A row that names a rule outside the rule's scope must not be hidden by normalisation. Outside its scope it is a real difference.
- R8.3 A pair must show its noise floor. A difference below it is not a finding.

### Rules (normalisers) with scope

```
rules: { id: "text" | { text, evidence, applies: { pairs?, artifacts?, kinds?, targets? } } }
```

- R8.4 A rule must carry its evidence. A rule without evidence must not be accepted.
- R8.5 A list in `applies` limits that axis. A missing list means no limit on that axis.
- R8.6 The viewer shows the rules that fired on the target. The other rules in scope are collapsed.

---

## 9. Report format (schemaVersion 2)

- R9.1 `report.json` is additive over version 1. A file without `schemaVersion` is version 1 and is adapted. Nothing is dropped.
- R9.2 `report.json` must stay small. Large or tool-specific detail goes into sidecar files next to the run.
- R9.3 `meta.tools` must list every tool with name, version and settings hash.

```
meta       project, title, generated, matchBelow, primaryViewport, viewports[], groups?, tools[], sample?
runs[]     id, side, label, at, captures
pair       kind, aRunId, bRunId
entries[]  id, kind, title, path, group, judge?, note?, composedOf?, viewports[], artifacts, sample?
causes[]   id, title, detail, known
findings[] id, targetId, viewportId?, artifact, causeId
rules      { id: string | { text, evidence, applies } }
```

Sidecars (not in `report.json`):

```
runs/<id>/lighthouse/summary.json   compact metrics per target and viewport
runs/<id>/lighthouse/*.json|html    raw reports
runs/<id>/content/findings.json     check output
runs/<id>/behavior/<target>/        trace, video, step screenshots
```

- R9.4 `report.json` holds, per artifact, an index entry: kind, path of the sidecar, tool, version, settings hash.
- R9.5 A component and a page use the same report. A page lists its components in `composedOf`. The viewer shows "composed of" and, on the component, "used on".

---

## 10. Viewer

The viewer evolves upstream `report-viewer.html`. It stays one shell with several views.

- R10.1 Plain ES modules, CSS layers (`tokens, base, shell, components, views`), no bundler, no dependency. It needs a file server.
- R10.2 The toolbar must fit one row at 1100 px and wider. It hides parts in a fixed order below that.
- R10.3 The left column must collapse with a button and with the `[` key. The choice must persist. On a phone it is a drawer.
- R10.4 Views: target detail, matrix (target by viewport), findings grouped by cause, timeline of runs, speed (only when the run has the artifact), content (only when checks ran).
- R10.5 The first view depends on the pair kind.
- R10.6 Report data must never become markup. Text only.
- R10.7 Every state change must go through one action list. Views must not write state.
- R10.8 The viewer must work in light and dark theme and at phone width with no horizontal page scroll.
- R10.9 When the browser blocks storage, the viewer must still render.
- R10.10 A data-source switch must exist inside the page (query strings may not survive hosting).

---

## 11. Agent interface

An agent must not read a whole report. It asks for the part it needs.

| Query | Answer |
| --- | --- |
| `summary` | verdict, counts per class, unexplained targets, omitted counts |
| `diff <target> --artifact screenshot --viewport <id>` | paths to crops of A, B and diff, regions in px |
| `diff <target> --artifact html` | changed lines after normalisation, rules applied |
| `content <target>` | findings of enabled checks |
| `perf --regressions` | metrics beyond the noise, budget breaches |
| `behavior <target>` | failed step, result A and B, evidence paths |

- R11.1 The agent output is JSON for text and a file path for images. It must use the same classification code as the viewer.
- R11.2 Every query needs a target or a filter and must have a size limit (`--max-targets`). When it cuts, it must say how many it left out.
- R11.3 Crops must come from the full-resolution original, not from a reduced preview.
- R11.4 `summary` should stay under about 5 kB for a normal report (estimate, not yet measured).
- R11.5 Each answer has a `next` field that names what the agent may do. Recording a known difference stays a command with evidence (R5.3).
- R11.6 A person and an agent open the same pair and see the same classes.

---

## 12. Storage and privacy

- R12.1 Runs live in `tests/visual/runs/<id>/`. The folder is in `.gitignore`. The run id grammar of `runs-store.js` stays.
- R12.2 Committed: viewport manifest, `sides`, target lists, `known_diffs`, the viewer shell. Not committed: captures, snapshots, raw tool output.
- R12.3 Content snapshots store the body compressed so that a new check needs no new crawl. They stay local.
- R12.4 Anything that reaches a public repository (issue, pull request, example data) must be anonymised: no client name, URL or screenshot.

---

## 13. Where it lives

Today the visual tooling is about twenty files tracked in the `tailwind-base` skeleton manifest. Each project holds a
copy, and each downstream skeleton holds a copy of that copy. This tool adds an engine, a viewer, checks and a query
interface. That is too much to keep as copies.

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| A. Skeleton files (today) | Files in `tailwind-base`, synced into every project | No new repository | Drift between copies. Every fix ships as a sync. Grows with each artifact and check. |
| B. Inside `parisek/styleguide` | A new surface of the Composer package | One catalogue, close to the component data | The package is PHP and ships no Node. The engine needs Node, Playwright and Lighthouse. The viewer would be rewritten in the Vue chrome. The two release cadences would be tied. |
| C. Own package, next to the styleguide | A Node package: engine, viewer shell, query CLI, starter checks. Projects add configuration and targets only. | One copy per version. A project pins a version. Updates by `npm update`. The viewer ships in the package and a command serves it, so no file server is needed. | A new repository to maintain. A second distribution channel next to Composer. |

Recommendation: **C**, with an explicit contract to the styleguide.

- R13.1 The package must hold the engine, the viewer shell, the query CLI and the starter checks. A project must hold configuration, targets and its own checks only.
- R13.2 The package must stay data-driven. It must not contain project names, URLs or sample data of a client.
- R13.3 The styleguide stays the source of component data. The package should read targets and `usage:` (composed of, used on) from the styleguide REST endpoints (`/styleguide/api/components`, `/api/pages`) and may accept a plain URL list instead.
- R13.4 The styleguide may link to the viewer, and the viewer must link back to the component in the styleguide. Neither may import the other's code.
- R13.5 The viewer should reuse the layout and the design tokens of the styleguide chrome so that both look like one product. It stays plain ES modules. A shared token file may come later.
- R13.6 The first version must live in the repository that will become the package. It must not start as skeleton files that move later, because a move is a second migration.
- R13.7 `tailwind-base` keeps only: the doctrine (`visual-comparison.md`), a configuration stub, and thin command aliases that call the package.

### Scope over time: the testing infrastructure moves in steps

The owner wants the testing infrastructure of `tailwind-base` to move into the package step by step. Measured 2026-10-07 on the
skeleton manifest: 237 files under `static/tests/`.

| Area | Files | Kind | Moves? |
| --- | --- | --- | --- |
| `visual` | 14 | Playwright capture, diff, report | yes, first (folds into the comparison tool) |
| `behavior` | 22 | Playwright runner and contract API | yes. Project-owned `*.contract.js` files stay in the project. |
| `lib` | 45 | shared helpers | only what the moved areas use. A dependency check must come first. |
| `cross-engine`, `browser-support` | 7 | engine-gap and support checks | yes, after `behavior` |
| `fixtures.spec.js`, `fixtures.unverified.txt` | 2 | fixture checks | decide with `behavior` |
| `twig-cs-fixer`, `phpstan` | 116 | PHP lint rules | yes, but into a separate Composer package, `parisek/lint-kit` (see the separate `lint-kit` issue). Not into `test-kit`. |
| `eslint`, `stylelint` | 31 | JS and CSS lint rules | no. Plugins of their linters. A separate decision. |

- R13.8 `test-kit` must cover testing and measuring: capture, compare, behaviour, checks, speed. PHP lint rules belong to a second package, `lint-kit`, in a separate issue. JS and CSS lint plugins stay a later decision.
- R13.9 Each move must be one pull request. After it, the project must work with no edit: a thin alias in the project calls the package (R13.7).
- R13.10 A move must replace the manifest entries of the moved files with one pinned dependency. `verify-skeleton` and `sync-skeleton` must know the new state before the first move merges.
- R13.11 A moved helper must not break a lint test that still imports it. The dependency check of `lib` must prove this before the move.
- R13.12 The name of the package must fit the final scope. A rename after the first release is costly.

Decided by the owner (2026-10-07): the package is `parisek/test-kit`, public from the first commit. R12.4 applies to the whole history.
npm name: `@parisek/test-kit` (an unscoped `test-kit` is taken). Open: whether the `@parisek` npm scope is owned, and the distribution channel.

---

## 14. Delivery plan

One logical change per pull request. Each is a draft, assigned to the owner. Each follows chat, approval, issue, draft pull request.

1. Doctrine in `visual-comparison.md`: side, run, pair, artifact, check, normaliser, known differences. No code.
2. `sides`, `visual:capture`, `visual:diff` with `screenshot`; the viewer evolves; old commands become aliases.
3. `html`, `status`, `behavior` artifacts; normaliser catalogue; noise-floor check.
4. Check contract and starter checks; `content` artifact.
5. `lighthouse` artifact, on request only; budgets.
6. Query CLI for agents.
7. The update skill calls the new commands.

---

## 15. Evidence and generality

- Two Drupal projects built a separate HTML compare script for a module migration, each with a list of proven environment differences. The same need, built twice.
- One WordPress project built, for a structure migration, a content crawler with local snapshots and check modules, and a speed harness (typed pages, three runs, a warm-up request, a load guard, trends). They are the model for sections 6, 7 and R6.x.
- Measured 2026-10-05: 112 WordPress and 22 Drupal projects have a theme `static/`. 21 of 134 carry the shared visual libraries today. The libraries sync through the skeleton.
- The floor counts only projects with the shared libraries. A project with its own tool is not counted.

---

## 16. Verification status

| Item | State |
| --- | --- |
| Viewer prototype with sample data | built, 62 unit tests pass |
| Viewer in the artifact frame | checked by hand |
| Adapter on a real `report.json` from `build-report.js` | not tested |
| Any runner that writes behaviour `steps[]` | does not exist |
| Real screenshots in behaviour steps | not tested |
| Keyboard navigation, widths 860 to 1099 px | read in code, not run |
| Speed run count and noise band in a DDEV setup | not measured |
| Agent `summary` size | not measured |

## 17. Open questions

1. (decided) The engine lives in the separate package `parisek/test-kit` (section 13). Open: the npm scope and the release channel.
2. Which checks form the small default set?
3. Does measuring production for speed need a separate explicit command?
4. How long are content snapshots kept, and who deletes them?
5. Which language-detection library, after the section R7.6 check?
