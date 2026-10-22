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
| subject | One run checked on its own, with no pair. |
| artifact | A kind of evidence in a run: `screenshot`, `html`, `status`, `behavior`, `lighthouse`, `content`, `lint`, `a11y`. |
| check | A small module that reads one artifact and reports findings (heading outline, language). It has a **basis**: `absolute` or `relative` (R8.10). |
| finding | One difference or defect on a target, in an artifact, optionally in a viewport. |
| cause | A named reason that explains findings. It may be known (accepted) or unknown. |
| class | `match`, `explained`, `unexplained`, `oracle`. Derived, never stored. Only complete evidence has a class. |
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

- R3.1 For a pair, the pair kind must decide which normalisers apply and which view opens first.
- R3.2 A pair across two environments must not be used to judge speed (see R6.5).
- R3.3 A side may set `remote: true`. A remote side may use any HTTP or HTTPS origin without credentials or a path. Its capture must send GET and HEAD to that origin only. It must abort a frame or subresource of another origin and keep the capture. It must fail the capture on a redirect, popup or top-level navigation to another origin, and on any other method. Speed (`perf`) and DDEV discovery must refuse a remote side. A side without `remote: true` must stay local. (Issue #90)

---

## 4. Architecture

```
config (global)  ->  capture  ->  runs (local disk)  ->  compare  ->  report.json + sidecars
                                                                          |-> viewer (person)
                                                                          |-> query CLI (agent)
```

- R4.1 Capture and compare are two commands: `visual:capture --side <s> --label <l>` and `visual:diff <runA> <runB>`.
- R4.2 One navigation per target and viewport must feed all artifacts requested for that capture. Asset requests, redirects, and explicit behavior steps are not additional artifact navigations. Speed uses the separate repeated-run contract in R6.6.
- R4.3 The old commands (`visual:harvest`, `visual:compare`, `test:visual`) stay as thin aliases. No project changes.
- R4.4 The pure logic (classification, scope of rules, adapters) must have no DOM dependency and must have unit tests.

---

## 5. Configuration (global)

One project file declares everything. A run copies the settings it used into itself, so an old run stays readable after the file changes.

```yaml
sides:     { local: {...}, production: {...}, styleguide: {...} }
targets:   { source: manifest | styleguide | list, ... }
viewports: from the viewport manifest
artifacts: [screenshot]                        # default set (code); others on request
checks:    [heading-outline, lang, empty-alt]  # example only; no check runs by default (section 17)
packs:     [a11y]                              # opt-in packs; none by default (R13.44)
budgets:   { /: { lcp_ms: 2500 } }             # speed limits per target
known_diffs: { <pair>: [ { target, cause, evidence } ] }   # belongs to a pair, not a side
```

- R5.1 The default set of artifacts and checks must be small. Everything else must need `--artifacts` or `--checks`. An absent `artifacts` key means the normalized default (`screenshot`) for every command alike: `run`, `before`, `after`, `capture` and `diff`. The default set of checks is empty. A check runs only when the project selects it with `checks` or `--checks`. Decided by the owner on 2026-10-22.
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

- R6.1 `status` is shown but is not counted in the class of a target. Availability is a separate field. HTTP errors and capture errors must remain visible in the viewer and query output, even when captured pixels match. A captured HTTP error page is evidence, not a navigation exception.
- R6.2 A `behavior` step has: title, state (`same`, `changed`, `failed`), result A, result B, and evidence (screenshot, console, network, `dataLayer`, DOM).
- R6.3 A behaviour recording (trace, video) stays local. The viewer shows the command `npx playwright show-trace <path>`.
- R6.4 Every artifact must record the tool name, the tool version and a hash of the settings it used.

### Speed (`lighthouse`)

- R6.5 Speed must run only on request. A command that would run more than a few targets must state its cost and wait for consent. On a production side, `perf` must state its cost and wait for `--consent` for any number of targets, one target included. There is no separate command for production speed. Decided by the owner on 2026-10-22 (issue #162). How the code knows that a side is production is open (issue #162).
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
export const basis = 'absolute';
export const applies = { artifacts: ['html'] };
export function check(doc, ctx) { return [ /* { target, severity, message, evidence } */ ]; }
```

- A check without `basis` is relative. The absolute parts of R7.2, R7.3, R8.2 to R8.13 (R8.14 applies now) and R9.7 to R9.11 take effect with `schemaVersion` 3 (R13.9). Until then the shipped behaviour stands.
- R7.1 A check must be a pure function of the stored artifact. A new check must run over an existing run without a new capture.
- R7.2 A check must export `id`, `title`, `basis`, `applies` and `check`. A CLI entry, if any, must sit behind an `import.meta.url` guard.
- R7.3 Findings of a check go into the same `findings` list as findings of any artifact. A class applies by the basis of the check (section 8). Normaliser rules and known differences apply to relative checks only.
- R7.4 A run stores the version of each extractor that read its content. Two runs with different extractor versions must not be compared silently.
- R7.5 Starter checks: heading outline (one `h1`, no skipped level), page language against the expected one, empty `title` and `alt`, broken internal links, text difference A against B.
- R7.7 Content checks keep the stored pure check contract. Browser contracts keep `name`, `detect`, and `run`. An explicit name list selects checks or contracts. Unknown or duplicate names fail. An empty behavior selection records no executed assertion. A skipped contract does not prove a pass.

- R7.6 A language-detection check needs a library. Add it only after a check of origin, releases and advisories.

---

## 8. Classification

Derived from findings, the basis of each check and `matchBelow`. Never stored.

- A check without `basis` is relative. The absolute parts of R7.2, R7.3, R8.2 to R8.13 (R8.14 applies now) and R9.7 to R9.11 take effect with `schemaVersion` 3 (R13.9). Until then the shipped behaviour stands.
- R8.10 Every check has a basis, `absolute` or `relative`. A `relative` check reports a difference between A and B and needs a pair. An `absolute` check reports on one run and needs no pair. The basis belongs to the check, not to the finding.
- R8.11 A finding names its check with `checkId`. A finding with no `checkId` is `relative`. A finding of an absolute check always has a `checkId`, whatever its artifact, and the catalog of the report lists it (section 9). A finding of the `screenshot` or `html` comparison has no `checkId`. A finding of any other artifact must have one.

| Class | Relative basis | Absolute basis |
| --- | --- | --- |
| `match` | comparable evidence with no finding; `matchBelow` is a display hint | complete evidence with no finding |
| `explained` | every finding has a known cause | every finding has an allowlist entry (the allowlist is not specified yet; until it ships, an absolute finding is `unexplained`) |
| `unexplained` | at least one finding with no known cause | at least one finding with no allowlist entry |
| `oracle` | the target judges by a rule, not by ratio (`judge: oracle`). Never coloured by ratio. | same |

- R8.12 A report may mix both bases. Class derives from state first (R8.7). A scope whose artifact is not `complete` has class `null`, and the summary counts it as incomplete. A finding of an artifact that is not `complete` never enters class aggregation. Such a scope is never `match`, even with no findings. A scope with a complete artifact and no findings is `match`. For the other scopes, the class of a target is the worst class over all findings in scope. The order, worst first, is `unexplained`, `explained`, `oracle`, `match`.

- R8.1 The default `matchBelow` is 3 percent. It is a compass. The report must not call it a verdict.
- R8.2 A row that names a rule outside the rule's scope must not be hidden by normalisation. Outside its scope it is a real difference. Normaliser rules apply to relative checks only, so no rule can hide an absolute finding. An override or allowlist entry outside its scope has no effect. The allowlist is not specified yet (ADR 0004 open question 4).
- R8.3 A pair must show its noise floor. A measured difference below it is not a finding. An unmeasured floor is `null`, never zero. Without a measured floor, a nonzero screenshot ratio produces a finding. The `matchBelow` hint must not suppress that finding. The noise floor belongs to a pair. An absolute check has no noise floor.
- R8.7 Measurement state is separate from class: `complete`, `missing`, `failed`, or `incompatible`. Missing evidence, capture failure, and incompatible settings must never become `match`. A query counts these states separately. This holds for absolute checks. A check with no input gives `missing`. An empty check set gives `missing`. A check that throws or times out gives no finding. Its artifact is not `complete`. An empty `findings` list says nothing about an artifact that is not `complete`.
- R8.8 A screenshot finding applies to one target and viewport. A class uses findings in that same scope. Target aggregation considers all comparable viewport findings and retains incomplete measurement states.
- R8.9 Comparison must reject incompatible viewport dimensions, artifact settings, or tool versions with an explicit diagnostic. A run preserves the settings it used. Labels and origins do not determine artifact compatibility.

### Rules (normalisers) with scope

```
rules: { id: "text" | { text, evidence, applies: { pairs?, artifacts?, kinds?, targets? } } }
```

- R8.4 A rule must carry its evidence. A rule without evidence must not be accepted.
- R8.5 A list in `applies` limits that axis. A missing list means no limit on that axis. The same holds for the scope of an override or an allowlist entry on the axes `artifacts`, `targets` and `kinds`. The `kinds` axis takes the value `single-run`. The `pairs` axis does not apply to a `subject` report. The allowlist is not specified yet (ADR 0004 open question 4).
- R8.6 The viewer shows the rules that fired on the target. The other rules in scope are collapsed. For an absolute check, a check fired when it has at least one finding on the target. The viewer lists the fired checks first, each with its `checkId`, title, `layer` and finding count, and collapses the other checks of the catalog. A check whose artifact is not `complete` shows as `missing`, `failed` or `incompatible`, never as a check with no finding.
- R8.13 A narrower layer may switch an absolute check off. This writes an override record in the report (section 9), and the check has state `missing` with a diagnostic. A disabled check proves nothing (R7.7). An override must never hide a failed or missing run, a rule without evidence (R8.4) or an unexplained non-zero difference. A query counts overrides.
- R8.14 An absolute check that finds a result it cannot decide stays `complete`. It reports each undecided item as a `warning` finding with `evidence.needsReview: true`. A cut list of findings (the `truncated` warning of the accessibility pack, `evidence.truncated: true`) follows the same rule. It does not report `missing` for it, because `missing` drops every finding of the check from class aggregation (R8.12) and would hide the real violations next to it. The accessibility pack applies this to axe `incomplete` results. A consumer that gates on these items tests `evidence.needsReview` or `evidence.truncated`. A gate on severity `error` alone does not see them. R8.14 applies now. The accessibility pack ships it, and it does not wait for `schemaVersion` 3.

---

## 9. Report format (schemaVersion 3)

The code writes version 2 until the report-shape change ships (ADR 0004). R9.7 to R9.11 describe version 3.

- R9.1 A reader adapts an older `report.json` and drops nothing. A file without `schemaVersion` is version 1. Version 3 is not additive over version 2: `pair` becomes optional (R9.7). A reader that supports only version 2 rejects a version 3 file with a message about `schemaVersion`.
- R9.2 `report.json` must stay small. Large or tool-specific detail goes into sidecar files next to the run.
- R9.3 `meta.tools` must list every tool with name, version and settings hash.

```
meta       project, title, generated, matchBelow, primaryViewport, viewports[], groups?, tools[], sample?
runs[]     id, side, label, at, captures
pair       kind, aRunId, bRunId          (exactly one of pair and subject)
subject    kind: 'single-run', runId, key?
checks     { <checkId>: { basis, layer, title } }
entries[]  id, kind, title, path, group, judge?, note?, composedOf?, viewports[], artifacts, sample?
causes[]   id, title, detail, known
findings[] id, targetId, viewportId?, artifact, causeId, checkId?, runId?, layer?, location?
overrides[] checkId, scope, reason, owner, layer
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
- R9.6 The v0.1 serialized config, run, and screenshot report contract is `docs/contracts.md`. A comparison preserves raw captures. It does not rewrite the original evidence.
- R9.5 A component and a page use the same report. A page lists its components in `composedOf`. The viewer shows "composed of" and, on the component, "used on".
- R9.7 A report has exactly one of `pair` and `subject`. `pair` is required for relative results. `subject` is required when there is no pair. `subject.key` is a hash of the run id. It replaces `pair.key` in the policy identity check, and it is present exactly when `meta.comparisonPolicyHash` exists. A `relative` check in a report with a `subject` is a validation error. A `subject` report must hold `rules: {}` and no `known_diffs`.
- R9.8 The producer writes the `checks` catalog, one entry for each selected check. A `checkId` that is not in the catalog is a validation error. `layer` is the narrowest layer that contributed the rule that fired: `package`, `project`, `component` or `page`. An absolute finding carries `runId`: `aRunId` or `bRunId` in a pair report, `subject.runId` in a `subject` report. A relative finding carries no `runId`. A mismatch is a validation error.
- R9.9 An absolute result sits at the scope of its evidence: `entries[].viewports[].artifacts.<kind>` or `entries[].artifacts.<kind>`. A `complete` artifact of an absolute-only kind (for example `lint`, or any artifact in a `subject` report) has this index entry and has no `a`, `b` or `diff`: `{ state, diagnostic?, evidence: { src, tool, version, settingsHash }, result: { violations, checks } }`. `result.checks` counts the executed checks. A count of 0 gives state `missing`. A relative artifact keeps `a`, `b` and `diff`. An unknown artifact kind is a validation error.
- R9.10 The `content` artifact in a pair report keeps `a`, `b` and `diff` and may hold relative and absolute findings. Each finding is judged by its own basis. The artifact is `explained` only if every finding is. Its state is `complete` only if all selected checks completed. The state is the worst state of its selected checks. A check in the catalog with no outcome reads as `missing`. This holds for run-level selection. Selection per target is open (ADR 0004 open question 2). The per-check outcomes (check id, and a state of `passed`, `failed` or `incomplete`) live in the sidecar, not in `report.json`. So a completed check with no findings differs from a check with no outcome.
- R9.11 A `lint` finding has no `viewportId`. It carries a `location`, bounded in size: `{ file, line, column }` or `{ selector }`. Its `targetId` is the component id when the file maps to a component, and otherwise the reserved id `@project` with entry kind `project`. The producer writes the `@project` entry. It is not a configured target.

---

## 10. Viewer

The viewer evolves upstream `report-viewer.html`. It stays one shell with several views.

- R10.1 The viewer uses Vue 3 components, Vite, and Tailwind 4. The package commits the compiled viewer. A project needs no frontend build or frontend dependency. The viewer is a static application. It needs no process and loads under any URL prefix (R10.11). The local server is a convenience that serves the same files (ADR 0005). The owner accepts this stack on 2026-10-09.
- R10.2 The header wraps its items by the width of their content. It has no breakpoint rule and hides nothing. The page never scrolls sideways (R10.8). Test: at 390 px wide, every header item is visible and the page has no horizontal scroll. The target drawer of R10.3 is a separate rule.
- R10.3 The viewer has a Home page when it loads `index.json` and a Report page when it loads a report (design files: `docs/viewer-workflow.md`, `DESIGN.md`). The Home lists the comparisons of a publish directory (R10.13). It has no permanent side panel. A report has a breadcrumb as the first element of the content column. In a publish directory its first item returns to the Home. On the Evidence view it returns to the Overview. Older and newer comparison links are a separate navigation, in time order, and exist only when `index.json` supplies that order. Older is the next entry in the order of `reports` and newer is the previous one. Both skip entries whose `path` is `null`. The page counter counts only the remaining entries. A viewer with an adjacent `report.json` (R10.11 export) opens the Report directly. It has no Home item and no older or newer links. It keeps the breadcrumb for the way up from Evidence. On the Evidence view the target list is a panel. It must collapse with a button and with the `[` key. The choice must persist. On a phone it is a drawer.
- R10.4 A report has four views: Overview (target by viewport), Evidence (one target or finding: viewport, evidence type and mode), Findings (grouped by cause) and Run info (the runs of the report, their settings and the timeline of runs, as in the former timeline view). The evidence types are screenshot, HTML, status, content and speed. Content and speed show only when the run has that artifact: content when checks ran, speed when the run has the Lighthouse artifact. R6.10 still holds in the speed evidence type. Overview and Findings stay the views across targets. Run info keeps the timeline of runs. Decided by the owner on 2026-10-22 (issue #155).
- R10.5 A report opens on Overview, unless the deep link names a view (R10.14). The viewer never changes the active view without telling the person. The first view no longer depends on the pair kind.
- R10.6 Report data must never become markup. Text only.
- R10.7 Every state change must go through one action list. Views must not write state.
- R10.8 The viewer must work in light and dark theme and at phone width with no horizontal page scroll.
- R10.9 When the browser blocks storage, the viewer must still render.
- R10.10 Status: the missing-source rule is implemented (issue #147). The form shows only when both sources are missing (issue #148). A data-source form must exist inside the page, because query strings may not survive hosting. The viewer shows it only when the adjacent `report.json` and `index.json` are both missing. A source is missing when it answers HTTP 404, or answers HTTP 2xx with a body whose first character is `<` after an optional byte order mark and white space. The second case is an HTML page. A status that is neither 404 nor 2xx is an ordinary error, whatever its body. `index.json` follows the same test. A front controller serves one for an unknown path, with HTTP 200 (issue #147). A report is a JSON object, so such a body is never one. Any other load failure, and malformed JSON, show their own message and no form (R10.13). A page that loads either source does not show the form.
- R10.11 Report and history export write static directories and start no server. The viewer loads under any URL prefix. Report data and artifact references stay in that report directory. Server and export share one allowed-file index. Export gives untrusted evidence safe generated names and non-executable types. Only trusted viewer and history shells use HTML. `--export` refuses an existing output directory. Only the named refresh of R10.12 replaces content in place.
- R10.12 Status: implemented. `history --publish DIR` must refresh a publish directory in place (ADR 0005). The package holds no default directory and no config key: `DIR` comes from the flag, and a project alias passes it (R13.7). `DIR` is outside the history store, which defaults to `.test-kit`. Example: `site`.
  1. Content. `DIR` holds the marker `.test-kit-publish`, `index.json`, one viewer copy (`index.html`, `app.js`, `style.css`), and what `scanHistory` finds. For each report: `report.json` and allowed evidence. For each run: `run.json` only, copied as is (it holds `settings`). No run artifact is copied. A store entry that `scanHistory` marks unreadable is listed in `index.json` with `null` fields and `path` `null`. No file is copied for it. A report whose evidence file is missing or oversized is treated the same way: it is listed with `path` `null` only, and every other field comes from its readable `report.json` as usual. Nothing is copied for it, a warning line names the report, and the refresh continues with exit 0. A readable report that fails validation is treated like a report whose evidence is missing. Any other report error (for example a corrupt behavior sidecar, or a sidecar that escapes the report root) fails S2 and names the report. A person must fix or remove that report before the next publish. This differs from `report --export`, which fails on such a file. Publish covers a whole store, and a person may remove runs from it (section 17, item 4), so missing evidence is an expected state (principle 1). Evidence uses the safe generated names and non-executable types of R10.11. The stage holds the marker too.
  2. Generated names. Beside `DIR` the command makes three siblings: the lock `<DIR>.test-kit-lock`, the stage `<DIR>.test-kit-new` and the backup `<DIR>.test-kit-old`. The command does not shorten names. Preflight item 2 refuses a `DIR` whose base name makes a sibling longer than 255 bytes (`NAME_MAX`), with a message. A project lists all three in `.gitignore`. Server rules such as `.htaccess` live outside `DIR`.
  3. Preflight. These checks run first, in this order. All run before any write, including the parent. The first failing check reports and exits 1. Later checks do not run.
     1. `--publish` is not used with `--export` or `--port`.
     2. The base name of `DIR` is short enough that each sibling stays within 255 bytes (`NAME_MAX`). This is a pure string check. It runs before any `lstat`.
     3. Resolve only the parent of `DIR` with `realpath` (read only): the deepest existing ancestor, plus the missing segments. The three siblings sit beside the leaf inside the resolved parent.
     4. The history store exists and is a directory, so a mistyped `--store` cannot replace a site with an empty one. `DIR` and the siblings are not the store, not inside it and not a parent of it.
     5. `DIR` is not the file system root, the home directory, the working directory, a parent of the working directory or a mount point. Mount point detection compares `st_dev` and is best effort.
     6. `lstat` of the unresolved leaf shows that `DIR` is missing or is a directory. A symlink or a regular file at `DIR` is refused.
     7. Check the lock, the stage and the backup by `lstat`. When any exists, print the recovery action of rule 5 and stop. This comes after items 1 to 6, so the command issues no recovery guidance for an unsafe `DIR`. The action names only paths that passed items 4 to 6.
     8. A non-empty existing `DIR` has the marker as a regular file. Its content, parsed as JSON, equals exactly `{ "tool": "test-kit", "kind": "publish", "schemaVersion": 1 }`. An extra field fails the check. A non-empty `DIR` with no valid marker is refused. A missing or empty `DIR` is allowed.
     9. In a marked `DIR`, each top-level entry is one the writer owns: the marker, `index.json`, `index.html`, `app.js`, `style.css` (regular files), `runs`, `reports` (real directories). Another entry, or a wrong type, is refused. The refusal names the foreign entry.
     Items 8 and 9 run only when the lock, the stage and the backup are absent, and again inside the lock (S1). So the table works also when `DIR` has no marker.

  4. Lock. The command creates a missing parent of `DIR`. This is the only write before the lock. Steps S1 to S6 follow. A concurrent refresh is refused by the lock. Every delete in this rule (S5, stage cleanup) removes a symlink as a link and never follows it. The command records the identity (device and inode) of the lock right after it creates it and removes the lock only while `lstat` still shows that identity. A replaced lock stays in place, and the message names it.

     - S1 Take the lock with an exclusive `mkdir` of `<DIR>.test-kit-lock`. Then repeat the checks of rule 3 on the stage, the backup, the leaf type (item 6), the marker and the owned entries, and record the identity (device and inode, from `lstat`) of `DIR`, or that it is missing. When one fails now, release the lock and refuse.
     - S2 Build the stage, with the marker.
     - S3 Immediately before the rename, repeat the leaf type, marker and owned-entry checks and compare the identity of `DIR` with S1. A change refuses: remove the stage, release the lock, exit 1, leave `DIR` as it is. Then, when `DIR` exists, rename `DIR` to the backup. Otherwise skip.
     - S4 Rename the stage to `DIR`.
     - S5 Remove the backup, if the command made it.
     - S6 Remove the lock.
  5. Recovery table. The command reads the state with `lstat`: lock L, stage S, backup B (present or absent), and `DIR` D (present or absent). When L, S or B exists, the command refuses to start. It prints the absolute path of each of L, S and B that exists, and the one-line action of this table. A stray sibling beside an unsafe `DIR` never becomes a destructive instruction, because the table applies only after preflight items 1 to 6. It says that a person must check for a crashed refresh, and that no refresh may be running before the person removes the lock. The command never deletes in this case. All 16 states are listed. None is impossible: a person can remove any sibling by hand.

     | B | S | D | L present | L absent |
     | --- | --- | --- | --- | --- |
     | present | any | absent | Rename B to `DIR`, then remove S (if present) and L. The old content is only in B. | Refuse. Same action as the left column, but L is not there to remove. |
     | present | absent | present | The swap finished and the new content is live. A cleanup of S5 stopped. Remove B and L. | Refuse. Remove B. |
     | present | present | present | The swap did not finish. Never remove B. Print: "compare <DIR> and <backup> by hand; remove <stage> and <lock> afterwards; keep the one you want as <DIR>". | Refuse. Print the same text, without the lock. |
     | absent | present | any | The refresh stopped before the swap. `DIR`, if present, is the old content. Remove S and L. When D is absent, this is a first publish: the action is the same. | Refuse. Remove S. |
     | absent | absent | any | Remove L. D present is complete (old or new). D absent means nothing was published yet. | Normal state. The refresh starts. |

  6. Failures. Until S4 succeeds, the old content is in `DIR` or in the backup. After S4 the new content is live, and the backup may be partly or fully removed. A reader can see a missing `DIR` between S3 and S4. The command does not claim atomicity. When a cleanup after a failure cannot remove the stage, the command exits 1 and prints the paths. The next run handles the state with the table (L absent, S present).

     | Step fails | Result |
     | --- | --- |
     | S1 re-check | Release the lock, remove nothing else, exit 1. |
     | S3 re-check | Remove the stage, release the lock, exit 1. `DIR` is unchanged. |
     | S2 | Remove the stage, release the lock, exit 1. `DIR` is unchanged. |
     | S3 | Remove the stage, release the lock, exit 1. |
     | S4, with a backup | Rename the backup back to `DIR`, remove the stage, release the lock, exit 1. If the rename back fails: keep the lock, the backup and the stage, print the three paths, exit 1. The kept stage marks the unfinished case in the recovery table. |
     | S4, no backup (first publish) | Remove the stage, release the lock, exit 1. `DIR` does not exist. |
     | S5 | The new content is live. Release the lock, print a warning that names the backup, exit 0. The next run refuses until a person removes the backup. |
     | S6 | The new content is live. Print a warning that names the lock path, exit 0. The next run refuses until a person removes the lock. |

  7. Crash points. Each point leads to one entry of the recovery table. Several points lead to the same entry by design.
     - After S1, and after S5: B absent, S absent, L present.
     - During S2, and after S2: B absent, S present.
     - After S3, before S4: B present, D absent.
     - After S4: B present, S absent, D present. For a first publish, B is absent too: B absent, S absent, L present.
     - S4 failed and the rename back failed: B present, S present, D absent or present. The table names the action for each.
  8. Message. On success the command writes this line to stderr: `test-kit: published to <absolute dir>; the directory contains captured pages.` The line is a message, not a gate. `run.json` holds `settings`, so the run settings are published too. The docs tell the project this. The package never uploads or exposes `DIR`. The project decides what its web server does. Nothing removes published runs automatically (section 17, item 4).
  9. Limit. A file that a person adds by hand below `runs/` or `reports/` is deleted with the backup. A marker is the project's own declaration, not proof that the package made the directory. A forged marker with owned names passes. A process that changes `DIR` between the last check before S3 and the rename can still make the command move that content to the backup and delete it. The command does not claim atomicity and has no lock against other writers of `DIR`. The lock guards against concurrent runs of this command and against mistakes. A local process that can write to the parent of `DIR` can swap the lock between its `mkdir` and its `lstat`, or reuse an inode. The command does not defend against it. The command does not scan foreign files below `runs/` or `reports/`. The rule guards against a typing error that names an unrelated directory. It does not guard against forgery.
- R10.13 Status: the writer is implemented, with `viewports` and `summary`. The Home shows them (issue #148). The writer is `history --publish` (`src/export/index-file.js`). The viewer reads the file (last bullet). The publish directory holds `index.json` at its root. R10.11 export differs: it copies the viewer into each report. The publish directory shares one viewer copy among its reports. The writer generates `index.json`. Nobody edits it by hand. Schema:

```
{ "schemaVersion": 1,
  "generatedAt": "<ISO 8601 UTC string>",
  "reports": [ { "id", "kind", "createdAt", "settingsHash", "path", "targets", "viewports", "summary" } ],
  "runs":    [ { "id", "createdAt", "settingsHash", "path" } ] }
```

  - `id` is the store id. `kind` is `pair.kind` of `report.json`, or `subject.kind` for a subject report. It is `null` unless it is a string. Code writes no subject report yet (schemaVersion 3 design, section 9), so that branch is for later.
  - `createdAt` is `null` unless it has the exact form of `Date.prototype.toISOString` (`YYYY-MM-DDTHH:mm:ss.sssZ`), so a string sort is correct. For a report it is `meta.generated`, the time of the comparison and not of the capture. For a run it is `at`. Sorting compares the strings.
  - `settingsHash` is the `sha256:` value of a run. For a run it is the `settingsHash` of its `run.json`. For a report it is the value of the run named by `pair.aRunId`, or by `subject.runId` for a subject report. Any `settingsHash` is `null` unless it is a string that starts with `sha256:`. A report value is `null` when run A or run B (`pair.bRunId`) is absent, unreadable or has no valid hash. The lookup uses only run ids that `scanHistory` found and `validId` accepts. It never uses an id read from report data directly. The writer reads the raw `report.json` that `scanHistory` reads, not the adapted report (`adaptV1` of `src/report/model.js` is not applied). A legacy v1 file has no `pair` or `subject`, so `kind` and the report `settingsHash` are `null`. When the A and B hashes differ, the comparison is `incompatible` (R8.9) and the report value is `null`.
  - `targets` is the number of `entries` in the raw `report.json`, or `null` when `entries` is not an array.
  - `viewports` is the number of `meta.viewports` in the raw `report.json`, or `null` when it is not an array.
  - `summary` is `null` when the report is unreadable, fails validation, or is a legacy v1 report that needs `adaptV1`. Otherwise it is `{ unexplained, explained, match, oracle, unclassified, incomplete }`. Each value is a non-negative integer that counts targets (`entries`). The first five partition the targets by target class (R8.12) and sum to `targets`. `unclassified` counts targets whose class is `null`. `incomplete` counts targets whose measurement state is not `complete` (R8.7). It is not a class and it overlaps the other five: a target can count as `unclassified` and `incomplete`. A readable report with missing or oversized evidence keeps its `summary`. The writer computes the counts with `targetClass` and `targetState` of `src/report/classify.js` (R11.6) and adds no new meaning. An index without `viewports` or `summary` stays valid (schemaVersion 1). The viewer then shows no counts for that row.
  - An unreadable entry has `null` in every field except `id`, and `path` `null`. A readable report with missing or oversized evidence, or one that fails validation, has only `path` `null`. Its other fields come from `report.json`, except `summary`, which is `null` for a report that fails validation. Otherwise it points to a file that is in `DIR`, and never to a missing file. It is relative to the directory: `reports/<id>/report.json` or `runs/<id>/run.json`. No path is absolute or holds `..`.
  - Unknown or unreadable is `null`, never `0` or an empty string (principle 1). An unreadable entry stays in the list with `null` fields.
  - Both lists sort newest first by `createdAt`, `null` last, ties by `id`, descending, by plain string comparison (`a > b`), not locale comparison. Valid ids use only `[A-Za-z0-9_-]`, so the order is by code unit. `scanHistory` uses `localeCompare`, which can differ for ids that differ in case. The index writer does not reuse that order.
  - The viewer treats the content as untrusted text (R10.6). A reader ignores an unknown field. An unknown `schemaVersion` is an error. A `reports` or `runs` value that is missing or not an array is an error ("malformed"), never an empty list. An entry with an invalid `id` is skipped and counted.
  - Viewer (implemented). A `report.json` next to `index.html` wins and `index.json` is not read. Only a missing file (R10.10) falls back to `index.json`. Malformed JSON and any other failure keep their own message. A report that is corrupt must not hide behind the list. The list shows the entries in the order of the file. An entry opens `reports/<id>/report.json`, built from the validated `id` and never from `path`. An entry with a `null` or other `path` shows as unavailable and is not a link. The plain anchor `#r-<id>` stays a valid deep link (R10.14). An anchor that names no available entry shows a notice.

- R10.14 Deep link. With an `index.json` the hash is `#r-<report id>/<view>/<target id>/<viewport id>/<artifact>/<finding id>?mode=<mode>`. When an adjacent `report.json` is loaded (R10.11), the hash drops the `r-<report id>` part. Split the hash at the first `?`, then split the path at `/`. Each part is percent-encoded (`encodeURIComponent`), so no part holds a raw `/` or `?`, and the viewer decodes each part before use. `view` is `overview`, `evidence`, `findings` or `info`. `artifact` names an evidence type of R10.4 by its artifact id: `screenshot`, `html`, `status`, `content` or `lighthouse` (shown as speed). A finding whose artifact is not one of these (for example `behavior`) has a link with an empty `artifact` segment (`.../<viewport>//<finding id>`). With `view` `overview` or `info`, the target, viewport, artifact and finding parts are ignored. `mode` is `side-by-side`, `overlay` or `difference`, and applies to `screenshot` only. The report id must pass `validId`. The viewer accepts a target id, a viewport id or a finding id only when the open report holds it. It matches against the report data, not against a pattern, so the reserved target id `@project` works (R9.11). A finding id selects the first finding with that id in report order. When that finding names a `targetId`, `viewportId` or `artifact` that differs from the path parts, the finding wins and the viewer shows a notice. Only the report id is required. A trailing part may be omitted. A middle part may be an empty segment. An omitted part takes the first valid value for its position. A part that is present but unknown, or that fails to decode, shows a notice and opens the Overview of that report. An unknown or unavailable report id shows the notice and opens the Home (R10.13). The plain `#r-<report id>` stays valid. The hash never carries a URL: a part that holds a colon, a slash or a backslash, after white space, control and format characters are removed, shows a notice, also in a part that the view ignores. An id that holds one of these characters gets no deep link. No id that test-kit writes holds one. The empty segments of the grammar (`//`) are not a URL. The viewer reads the hash on load and on `hashchange`, through the action list (R10.7). A change of view, target, viewport, evidence type, finding or mode adds one history entry, and so does opening the Home from the breadcrumb. Pure parse and build functions cover the grammar with unit tests (R4.4).
- R10.15 Design authority. The screens, the paths between them and the visual system follow `PRODUCT.md`, `DESIGN.md` and `docs/viewer-workflow.md` (`docs/vision.md`, "Design authority"). When one of these files and a requirement disagree, the requirement wins. A change to a rule in those files is Tier 3.

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
- R11.6 A person and an agent open the same report and see the same classes. `summary` returns `pair` for a report with a pair. Subject reports are a design (section 9) and no code writes them yet. Until then `summary` has no `subject` key. When subject reports exist, `summary` returns `subject` for them with `pair: null`, and `subject: null` for a pair report. That change is additive.

---

## 12. Storage and privacy

- R12.1 Low-level captures keep `tests/visual/runs/<id>/`. The opt-in project workflow uses a configured relative store, with `.test-kit/` as its default. Its `runs/`, `reports/`, and baseline state stay in `.gitignore`. The run id grammar of `runs-store.js` stays. No automatic deletion runs (section 17, item 4).
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
- R13.5 The viewer uses a copied, versioned UI token contract from the styleguide chrome. It records the source commit, licence, and file hashes. The packages have no runtime dependency on each other. Domain classes stay in test-kit.
- R13.6 The first version must live in the repository that will become the package. It must not start as skeleton files that move later, because a move is a second migration.
- R13.7 `tailwind-base` keeps only: the doctrine (`visual-comparison.md`), a configuration stub, and thin command aliases that call the package.

### Scope over time: the testing infrastructure moves in steps

The owner wants the testing infrastructure of `tailwind-base` to move into the package step by step. Measured 2026-10-07 on the
skeleton manifest: 237 files under `static/tests/`.

| Area | Files | Kind | Moves? |
| --- | --- | --- | --- |
| `visual` | 14 | Playwright capture, diff, report | yes, first (folds into the comparison tool) |
| `behavior` | 22 | Playwright runner, contract API, shared contracts | the engine: yes. Project-owned contracts (`contracts/project/`, `tests/behavior/project/`) stay in the project. The shared contracts: yes, as opt-in packs (R13.42). |
| `lib` | 45 | shared helpers | only what the moved areas use. A dependency check must come first. |
| `cross-engine`, `browser-support` | 7 | engine-gap and support checks | yes, after `behavior` |
| `fixtures.spec.js`, `fixtures.unverified.txt` | 2 | fixture checks | decide with `behavior` |
| `twig-cs-fixer`, `phpstan` | 116 | PHP lint rules | yes, but into a separate Composer package, `parisek/lint-kit` (see the separate `lint-kit` issue). Not into `test-kit`. |
| `eslint`, `stylelint` | 31 | JS and CSS lint rules | yes (decided by the owner, 2026-10-08). They are Node plugins and ship through the same channel as the rest of the package (R13.40). |

- R13.13 The package owns scoped project commands, per-selection baselines, and persistent local history. A project keeps configuration, project contracts, and thin aliases. A one-time run stores evidence without inventing an A/B pair. Partial captures cannot replace a complete baseline. DDEV origin discovery is opt-in.

- R13.8 `test-kit` must cover the Node side: capture, compare, behaviour, checks, speed, and the ESLint and Stylelint rules. PHP and Twig lint rules belong to a second package, `lint-kit`, in a separate issue. The dividing line is the toolchain and the channel (npm from a git tag against Composer from Packagist), not the purpose.
- R13.9 Each move must be one pull request. While the package is alpha, a step may break a project. Such a step needs a changelog entry and a migration note. The project pins a tag (R13.27), so a break reaches it only when it updates the pin. Owner decision, 2026-10-18. After the owner declares beta, each move must leave the project working with no edit: a thin alias in the project calls the package (R13.7).
- R13.10 A move must replace the manifest entries of the moved files with one pinned dependency. `verify-skeleton` and `sync-skeleton` must know the new state before the first move merges.
- R13.11 A moved helper must not break a lint test that still imports it. The dependency check of `lib` must prove this before the move.
- R13.12 The name of the package must fit the final scope. A rename after the first release is costly. The owner keeps the name `test-kit` (2026-10-08); the README must state the dividing line of R13.8.
- R13.40 The ESLint and Stylelint rules must ship as entry points of the package. Their rule identifiers and the plugin namespace (`portadesign/...`) must not change before a major version, because project configs, disable comments and baselines name them. The entry points are `@parisek/test-kit/eslint`, which exports a flat-config array, and `@parisek/test-kit/stylelint`, which exports a config object. A project file imports the entry point and adds its overrides after it. Decided by the owner on 2026-10-22.
- R13.41 The package must own the engine of the behaviour suite: the registry, the discovery, the reporter, the Playwright config and the format of the allowlists. A contract written by one project stays in that project.
- R13.42 The shared contracts (`picture`, `gsap`, `swiper`, `lightgallery`, `header-*`, `cookieconsent`, `axe`, `hygiene`, `render-integrity`) assert the behaviour of components that the skeleton ships. Accessibility (`axe`) and the component packs must live in the package as opt-in named entry points. A pack must run only when the project selects it (R5.1). Project-owned contracts must stay in the project. A component-specific pack must be versioned per library major version. The runner must detect the version. An unsupported or undetectable version must be a non-pass state (R8.7). A pack moves only in its own pull request. The owner accepted this on 2026-10-18. It supersedes the acceptance of 2026-10-09.
- R13.43 A move must keep the project-facing seam. While the package is alpha, R13.9 applies. Today a project overrides the canonical lint config in its own `eslint.config.js` and `.stylelintrc.cjs`, and adds contracts in `contracts/project/`. After the owner declares beta, the same project files must keep working with a thin import from the package.
- R13.44 A project must select packs with the `packs` key of its configuration: a list of built-in pack IDs (`a11y`, `lint`, `swiper`). An absent key selects no pack (G3, R5.1). An unknown ID, a duplicate ID or an entry that is not an ID must fail validation. The key takes no options, because the pack API has none. Config validation must stay pure: it reads a static list of IDs and imports no pack. Code maps the IDs to pack objects and passes them to `resolveChecks`. The selection must not enter the capture settings hash. This does not change the pack API (R13.42). Decided by the owner on 2026-10-19.

Decided by the owner (2026-10-07): the package is `parisek/test-kit`, public from the first commit. R12.4 applies to the whole history.

### 13.2 Distribution

Decided by the owner (2026-10-08): `test-kit` reaches a project through a git tag, not through the npm registry.

- R13.24 `test-kit` must be installed as a git dependency from the tags of `github:parisek/test-kit`. It must not be published to the npm registry. `package.json` must stay `private: true`, so a publish by mistake fails.
- R13.25 A release must be a tag `vMAJOR.MINOR.PATCH` on `main`. A tag must never move and must never be deleted. A fix is a new tag. Only the owner tags a stable release. The agent may create a dev prerelease tag `vMAJOR.MINOR.PATCH-dev.N`. It creates the tag from `main`. It creates the tag only after a green cumulative test run on the tagged commit. A dev tag is not a release. Owner decision, 2026-10-18.
- R13.26 A stable tag must equal `v` plus `version` in `package.json`. A dev tag must equal `v` plus `version` plus `-dev.N`. Here `version` is the base `X.Y.Z`. A workflow on a stable tag push must check that, run the tests, and create a GitHub Release from the matching section of `CHANGELOG.md`. A dev tag creates no GitHub Release. The trigger of `.github/workflows/release.yml` matches stable tags and release candidate tags (R13.45) only, so a dev tag starts no run. Owner decision, 2026-10-18.
- R13.45 A release candidate tag must have the form `vMAJOR.MINOR.PATCH-rc.N`, for example `v1.0.0-rc.1`. `N` is a positive integer with no leading zero. `N` starts at 1 and grows by 1 for each new candidate of the same `X.Y.Z`. The tag must equal `v` plus `version` in `package.json` plus `-rc.N`, with `version` the base `X.Y.Z` (R13.26). Only the owner tags a release candidate. The agent must never tag `-rc.N` or a stable release. The agent may tag `-dev.N` only (R13.25). The workflow on a candidate tag must run the same checks as on a stable tag (R13.26), and must create a GitHub Release marked as a prerelease from the `CHANGELOG.md` section `[X.Y.Z-rc.N]`. A candidate is not a stable release. Nothing marks it as the latest release. A dev tag still creates no Release. The seam freeze (`docs/seam.md`) starts at the first candidate tag, `-rc.1` (vision, open decision 9). Owner decision, 2026-10-19.
- R13.27 Before 1.0 a project must pin an exact tag: `npm install -D github:parisek/test-kit#v0.2.0`. After 1.0 it may use a range: `#semver:^1`. The lockfile pins the commit, so a moved tag cannot change a project.
- R13.28 The package must install without a build step. The `files` list in `package.json` decides what a project receives. The viewer build is committed. CI must verify that it matches its source.
- R13.29 The scoped name `@parisek/test-kit` needs no ownership of an npm scope for a git install. The name stays.
- R13.30 `git` must exist in the container that runs `npm install`. This is not yet verified for DDEV.
- R13.31 The package uses the MIT licence. The owner accepts this choice on 2026-10-09. The licence ships with the package before the first tag.

Verified 2026-10-08 on a local copy with two tags: npm installs from a tag and from a `semver:` range, `private: true` does not block it, only the `files` entries arrive, the `test-kit` command is linked, and the lockfile records the commit.

---

## 14. Delivery plan

One logical change per pull request. Each starts as a draft, assigned to the owner. One merge rule applies. It is stated in `docs/development-loop.md` (Merge rule) and in `docs/vision.md` (Review and merge). The owner approves each milestone and every stable release.

The v0.1 milestone delivers local screenshot capture, comparison, viewer, bounded summary, and verified git installation. It enables screenshots only and no checks. HTML/status artifacts, rules, behavior, content, speed, and lint remain later milestones. Basic HTTP availability metadata is part of screenshot capture. The original plan below describes the full scope, not one release.

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
| Runner that writes behaviour `steps[]` | verified with guarded local contracts and retained failures, 2026-10-09 |
| Real screenshots in behaviour steps | verified in synthetic Chromium capture, compare, query and viewer, 2026-10-09 |
| Viewer keyboard controls, blocked storage, widths 390, 860, 1100 px | verified in Chromium on synthetic data, 2026-10-09 |
| Local HTTP speed runner | one discarded warmup and three real Lighthouse 13.5 audits; command, comparison, query and compiled viewer verified, 2026-10-09 |
| Stored content checks | six explicit checks; compressed DOM, immutable reruns and evidenced acceptance verified, 2026-10-09 |
| Speed run count and noise band in a DDEV setup | not measured |
| Install from a git tag and from a `semver:` range (section 13.2) | verified on a local copy |
| Local Drupal screenshot pilot | two targets, two viewports; repeated A/A has no screenshot findings, 2026-10-09 |
| `git` inside the DDEV container | git 2.47.3; pinned GitHub commit installation verified, 2026-10-09 |
| The tag workflow (version check, GitHub Release) | not run; the first real tag is the test |
| Agent `summary` size | measured 1310 bytes for the six-target synthetic browser report, 2026-10-09 |

## 17. Open questions

1. (decided) The engine lives in the separate package `parisek/test-kit` (section 13), released as git tags (section 13.2).
2. (decided 2026-10-22) The default set of checks is empty (R5.1).
3. (decided 2026-10-22) No separate command. `perf` on a production side always waits for `--consent` (R6.5, issue #162).
4. (decided 2026-10-22) Snapshots and captures stay until a person removes them. Nothing removes them automatically (G3). A `history --prune` command removes old runs on request (issue #161). Its contract needs a spec change before code.
5. (deferred 2026-10-22) Which language-detection library, after the section R7.6 check? Not before 1.0 (issue #163).
6. (decided 2026-10-18) Accessibility and component packs live in the package as opt-in named entry points. Project-owned contracts stay in the project (R13.42). This supersedes the decision of 2026-10-09.
7. (decided 2026-10-22) The ESLint and Stylelint seam is an entry point with a thin import (R13.40, R13.43).
