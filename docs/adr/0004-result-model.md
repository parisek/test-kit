# ADR 0004: One result model for pair, single-run and lint results

Status: proposed. It waits for the owner (Tier 3, vision open decision 1). No code changes in this record.
Requirements: R7.1, R7.2, R7.3, R7.7, R8.2 to R8.9, R9.1, R9.4, R10.5, R11.6, R13.9, R13.13, R13.40. Tracked in #99.

## Context

Today every report is a pair. `validateReport` rejects a report without `pair.kind` from `PAIR_KINDS` and without `pair.aRunId` and `pair.bRunId` that name two runs (`src/report/model.js`). A finding refers to a target and to a viewport. It has no run and no layer.

Three kinds of result need one shape:

1. A comparative result: side A against side B (screenshot, HTML, status, behavior, speed, content difference).
2. A single-run absolute result: one stored run checked against a rule, with no other side (accessibility, hygiene, heading outline, expected language).
3. A lint finding: a rule violation at a file and a line (ESLint, Stylelint; R13.40, #26).

Principle 2 (one result, two readers) and R11.6 require the viewer and the query interface to use the same classification code. R7.3 requires that findings of a check go into the same `findings` list as all other findings, with no special case. R8.7 requires that missing, failed and incompatible evidence never becomes `match`. The vision says an ADR for this decision must merge before any single-run or lint work starts (`docs/vision.md`, "Open decisions" 1).

What the code does today, read from the files named here:

- Content checks already run on both sides. `compareContentSnapshots` runs each check on A and on B. Only the findings of side B enter the report: `result.findings = checks.flatMap(check => check.b.findings...)` (`src/content/compare.js`). Findings of side A stay in the sidecar. So an absolute rule such as `heading-outline` is already folded into a pair today by dropping side A.
- A check with no selected check ids does not become `match`. `compareContentArtifact` sets the state to `missing` with the diagnostic "No content checks are selected." (`src/content/compare-artifact.js`).
- A target can already steer its class by data. `judge: 'oracle'` makes `artifactClass`, `cellClass` and `targetClass` return `oracle` (`src/report/classify.js`). The class is never stored.
- `findingIsExplained` binds an acceptance to `report.pair.aRunId`, `report.pair.bRunId` and `report.pair.key`. `known_diffs` is keyed by `pair.key` (`src/rules/classify.js`, `src/rules/model.js`).
- `targetState` returns `missing` for a target with no viewports (`src/report/classify.js`). A lint finding has no viewport.
- Nothing names a layer. `grep -rn layer src` finds only `dataLayer` in `src/behavior/index.js`.
- The artifact enum in `normalizeScope` is `['screenshot', 'html', 'status', 'content']` (`src/rules/model.js`). It already lags `behavior` and `lighthouse`, which `validateReport` knows.

## Options

The vision lists three options. This section tests each one against the requirements.

### A: a single-run report with `findings[]` and no class

- R7.3: broken. Findings of a single-run check would live in a second report type, not in the one `findings` list.
- R11.6 and principle 2: broken. `summarizeReport` (`src/query/summary.js`) and the viewer need a second code path for a report without a pair.
- R8.2 to R8.7: not met. A report with no class has nowhere to show an allowlist entry, a missing run or an override.
- Additive: yes at file level. A new report type is a new file set.
- Pure logic: kept.
- Layer: free to add.
- Cost of change: the least edits to old files and the most new files. It duplicates the validator, the classifier, the query and the viewer views (see Cost).

### B: always a pair, with an implicit baseline

- R13.13: broken in its own words. "A one-time run stores evidence without inventing an A/B pair."
- R8.7: broken. `artifactClass` returns `match` for a complete artifact with no findings. A made-up baseline therefore turns "no rule fired" into `match`. A skipped or absent rule is also `match`.
- R8.3 and R8.9: a pair needs comparable settings. A made-up side has none.
- Additive: yes. Schema and validator stay as they are.
- Cost of change: the smallest on paper. It trades that cost for a false `match`. This is the reason to reject B, not the cost.

### C: a rule basis, `absolute` or `relative`, and a class derived at target or artifact scope

- R7.3: kept. One `findings` list. A finding of any basis goes in it.
- R8.2 to R8.7: kept, with the rules below for overrides and missing evidence.
- R11.6: kept. One classifier reads the basis from report data.
- Precedent: `judge: 'oracle'` already steers a derived class from a data field. The empty check set already gives `missing`, not `match`. C extends both rules.
- Additive at file level: yes. A new check and a new artifact `lint` are new files. Nothing runs by default (R5.1).
- Additive at schema level: no. `pair` becomes optional. This is a breaking change of the report schema.
- Pure logic: kept, with one rule. The classifier reads the basis from the report, never from a check module.
- Cost of change: the highest edit count in old files (see Cost). It is the only option that meets R7.3, R8.7, R11.6 and R13.13 together.

Summary:

| Criterion | A | B | C |
| --- | --- | --- | --- |
| R7.3 one findings list | fail | pass | pass |
| R8.7 no false `match` | not met | fail | pass |
| R13.13 no invented pair | pass | fail | pass |
| R11.6 one reader path | fail | pass | pass |
| Additive at schema level | yes | yes | no |
| Old files edited | fewest | few | most |

## Decision

Choose C. Define the details as follows.

### 1. Basis

A check or rule has a basis: `absolute` or `relative`.

- `relative`: the result is about a difference between A and B. It needs a pair.
- `absolute`: the result is about one run. It needs no pair.

The name is `basis`, not `kind`. `kind` already means the artifact kind (`kind: 'content'` in artifact indexes) and the pair kind.

A check module exports `basis` next to `id`, `title`, `applies` and `check` (a spec edit of R7.2). The producer copies the basis into the report. The classifier never imports a check module (R4.4). It reads this catalog:

```
checks   { <checkId>: { basis: 'absolute' | 'relative', layer, title } }
```

A finding names its check with `checkId`. A `checkId` that is not in the catalog is a validation error. A screenshot or HTML finding has no `checkId`. Its basis is `relative` by definition.

Class stays derived and never stored (section 8). The basis is a property of the rule, not of the finding. So C does not store class per finding.

### 2. Report shape

A report has exactly one of `pair` and `subject`.

- `pair`: as today. Required for relative results.
- `subject`: `{ kind: 'single-run', runId }`. Required when there is no pair.

`schemaVersion` becomes 3. Reasons: a reader of version 2 fails with a clear message at `schemaVersion`, not with a message about `pair.kind`. The tool adapts a version 2 file to version 3 without dropping a field (R9.1).

A `relative` check in a report with a `subject` and no pair is a validation error. It is never skipped without a trace (R7.7).

### 3. Run on a finding

A relative finding is about the difference. An absolute finding is about one run. An absolute finding carries `runId`. In a pair report, `runId` is `aRunId` or `bRunId`. In a subject report, it is `subject.runId`. A relative finding carries no `runId`. The validator rejects a mismatch.

This turns the current rule "only side B enters the list" into an explicit field. The decision for side A is below, in "Open points".

### 4. Layer

A finding carries `layer`: `package`, `project`, `component` or `page`. It is the narrowest layer that contributed the rule that fired. A project threshold on a package rule gives `project`. A page override gives `page`.

Layer is not class. A stored layer does not break R8.

The vision asks for pack fields only when a design needs them (layer rules, item 6). This record is that design for `layer` only. Pack identity stays in `checkId`.

### 5. Target and artifact scope

An absolute result sits at the scope where its evidence sits.

- Viewport scope: `entries[].viewports[].artifacts.<kind>`, as today. Content checks and accessibility use it.
- Target scope: `entries[].artifacts.<kind>`. The specification already lists `artifacts` on an entry (section 9). The validator reads only the viewport-level field today. A lint artifact uses target scope.

`targetState` and `targetClass` get a target-scope branch. Without it, a lint-only target has no viewports and reads as `missing` (see Context).

### 6. Lint finding

- Artifact: `lint`. Add it to the artifact lists in `validateReport`, `normalizeScope` and `queryArtifact`. At the same change, add `behavior` and `lighthouse` to `normalizeScope`, which lags today.
- `targetId`: the component id when the file maps to a component in the project configuration. Otherwise the fixed project entry `project`, with entry kind `project`.
- No `viewportId`. The file and the line go in `evidence`.
- Evidence is the stored linter output in a sidecar under the run (R9.2, R9.4). The report holds an index entry only.
- The entry-point shape of the linters (R13.40, spec section 17 item 7) stays open. This record does not decide it.

### 7. Evidence, overrides and allowlists

These rules follow R8.2 to R8.7 and vision layer rule 1.

1. Missing, failed and incompatible evidence for an absolute check gives state `missing`, `failed` or `incompatible`. It never gives `match`.
2. A check that has no input gives `missing`. An empty check set for a run gives `missing` (the current behavior).
3. A narrower layer that switches a rule off writes an override record in the report: `checkId`, scope, reason, owner, layer. The check at that scope has state `missing` with a diagnostic. A disabled check proves nothing (R7.7). The query counts overrides.
4. An override never hides a failed or missing run, a rule without evidence (R8.4) or an unexplained non-zero difference.
5. An absolute finding may become `explained` only through an allowlist entry. The entry carries a reason and an owner. It binds to `checkId`, `targetId` and the finding fingerprint. It does not bind to a run id or a pair key. Run ids change on each run, and an allowlist must outlive a run.
6. The binding in point 5 differs from today's acceptance, which binds to `pair.key`. The validator and `findingIsExplained` need a second branch for it. That work is the first follow-up issue. Until it ships, an absolute finding is never `explained`. It stays `unexplained`. This fails closed.

### 8. Classification

Class stays derived, never stored, at artifact, viewport and target scope (spec section 8). The four classes stay. The meaning for the absolute basis is:

| Class | Relative basis | Absolute basis |
| --- | --- | --- |
| `match` | comparable evidence, no finding | complete evidence, no finding |
| `explained` | every finding has a known cause | every finding has an allowlist entry |
| `unexplained` | a finding with no known cause | a finding with no allowlist entry |
| `oracle` | unchanged | unchanged |

A report may mix both bases. Target class is the worst class over all findings in scope. The viewer chooses its labels from the basis. For an absolute finding it says "no finding", "allowlisted" and "violation". Labels are a Tier 1 detail. The class names change the specification table, so that edit needs the owner.

### 9. First view and summary

R10.5 picks the first view from `pair.kind`. A report with a `subject` opens the findings view. `summarizeReport` returns `subject` where it returns `pair` today. It returns `null` for the other.

### 10. Pure logic

The classifier, the validator and the scope rules stay pure. They read basis, layer and overrides from report data. They do not import a check, read a file or use the DOM (R4.4).

## Worked mapping

All examples use `example-site`. None of them passes today's `validateReport`. That gap is the change.

Catalog used by the three examples:

```json
{
  "schemaVersion": 3,
  "checks": {
    "html-diff": { "basis": "relative", "layer": "package", "title": "HTML difference" },
    "heading-outline": { "basis": "absolute", "layer": "package", "title": "Heading outline" },
    "eslint-no-console": { "basis": "absolute", "layer": "project", "title": "No console call" }
  }
}
```

### Pair result (relative)

Report has `pair: { "kind": "update", "aRunId": "run-a", "bRunId": "run-b" }`. The finding has no `runId` and no `checkId`:

```json
{
  "id": "f-1",
  "targetId": "home",
  "viewportId": "desktop",
  "artifact": "html",
  "causeId": null,
  "layer": "package"
}
```

This differs from today by one field, `layer`. Class: `unexplained` until a known cause matches (unchanged).

### Single-run result (absolute)

Report has `subject: { "kind": "single-run", "runId": "run-1" }` and no `pair`.

```json
{
  "id": "f-2",
  "targetId": "home",
  "viewportId": "desktop",
  "artifact": "content",
  "checkId": "heading-outline",
  "runId": "run-1",
  "layer": "package",
  "severity": "warning",
  "message": "The page has no h1.",
  "evidence": {}
}
```

Class at the target: `unexplained` (a finding with no allowlist entry; see section 7 point 6). With complete evidence and no finding the class is `match`. With no stored snapshot the state is `missing` and the class is `null`.

### Lint finding (absolute)

Report has a `subject`. The target is the fixed project entry because the file does not map to a component:

```json
{
  "id": "f-3",
  "targetId": "project",
  "artifact": "lint",
  "checkId": "eslint-no-console",
  "runId": "run-1",
  "layer": "project",
  "severity": "error",
  "message": "Unexpected console statement.",
  "evidence": { "file": "src/example-site/header.js", "line": 12, "column": 3 }
}
```

The entry is `{ "id": "project", "kind": "project", "viewports": [], "artifacts": { "lint": { "state": "complete", "diff": null } } }`. The lint artifact sits at target scope (section 5).

## Cost

Method. The commands run in the repository root on `origin/main` at commit `73f74d3` on 2026-10-18. The count is files that contain the pattern. A file that contains it may need no edit. A file that does not contain it may still need one. So the count is an upper bound for review work and a lower bound for edits. It is a measurement of reach, not an estimate of effort.

```bash
P='report\.pair|\.pair\b|aRunId|bRunId|pairKey'
C='targetClass|cellClass|artifactClass|findingIsExplained|findingsFor|targetState|cellState|CLASSES'
F='\.findings\b|findings:'
grep -rlE "$P|$C|$F" src frontend/src --include='*.js' --include='*.vue' | grep -v spec | wc -l
grep -rlE "$P|$C|$F" tests frontend/src --include='*.js' | grep -E 'spec|test' | wc -l
find src frontend/src \( -name '*.js' -o -name '*.vue' \) | grep -v spec | wc -l
```

Result (measured):

- 27 of 93 non-spec files in `src/` and `frontend/src/` match.
- 14 test files and spec files match.
- `viewer/` is the compiled output. It is not counted and not edited by hand.
- `npm test` runs 161 tests and passes on `main`.

The 27 files by layer:

| Layer | Files | Count |
| --- | --- | --- |
| Schema and validator | `src/report/model.js` | 1 |
| Classifier and rules | `src/report/classify.js`, `src/rules/classify.js`, `src/rules/model.js`, `src/rules/record.js`, `src/rules/evidence.js` | 5 |
| Query | `src/query/summary.js`, `src/query/artifact.js` | 2 |
| Viewer | `App.vue`, `ContentComparison.vue`, `FindingCards.vue`, `FindingsView.vue`, `MatrixView.vue`, `PerformanceComparison.vue`, `RuleAudit.vue`, `RunSummary.vue`, `TargetDetail.vue`, `state/useViewer.js` (all under `frontend/src/`) | 10 |
| Producers and other readers | `src/compare/runs.js`, `src/content/compare.js`, `src/content/compare-artifact.js`, `src/perf/compare-artifact.js`, `src/perf/model.js`, `src/perf/schema.js`, `src/cli/perf.js`, `src/history/index.js`, `src/workflow/feedback.js` | 9 |

The sum is 27. Per layer, per option, with the file counts above as the bound:

| Layer | A | B | C |
| --- | --- | --- | --- |
| Schema and validator | new validator, 1 new file | none | edit 1 file |
| Classifier | new classifier | none | edit `report/classify.js` and `rules/classify.js`, review 3 more (estimate) |
| Query | new query path | none | edit 2 (estimate) |
| Viewer | new views and a new first view | none | edit up to 10 (estimate) |
| Producers | add a new producer | add a baseline synthesizer | edit the content producer, add `lint` producer |

Which of the 10 viewer files need an edit is not measured. The ADR did not open the viewer files. The bound is 10 files plus the spec files among the 14 test files above. This is an estimate of the edit set, not a measurement.

Not measured: the effort in hours, and the number of lines.

## Consequences

- C is additive at file level and not additive at schema level. `schemaVersion` goes to 3. The package is alpha, so a break needs a changelog entry and a migration note (vision, Maturity). R13.9 still applies until the spec edit in #100 merges. The change cannot ship before that.
- The seam freezes at the 1.0 release candidate (vision decision 9). The result shape must be settled before it.
- `explained` for absolute findings needs an allowlist design. It is the first follow-up issue. Until it ships, an absolute finding is `unexplained`.
- Content checks keep the rule that only the findings of one side enter `findings`. With `runId` on the finding, this becomes a choice, not a habit. See "Open points".
- `validateContentComparison` accepts only ids in `builtinChecks`. A project or component rule needs the catalog route. That is part of the producer change.
- The spec edits this record implies: R7.2 (export `basis`), the class table in section 8, the shape in section 9 (`checks`, `subject`, `runId`, `layer`, `overrides`, `schemaVersion` 3) and R10.5 (first view without a pair). They land in a separate pull request, after the owner approves this record (#100 and #96 cover related edits).
- Follow-up issues, each opened after approval: report shape and validator; classifier branch for target scope and basis; allowlist binding; `lint` artifact and producer; viewer labels and first view; query changes. Their order and size are not decided here.

## Open points

1. Side A in a pair report. If an absolute rule runs on both sides, the report can show a violation that exists on both sides. It cannot yet say "introduced by B". This record keeps today's behavior: a pair report lists the findings of side B. It stores `runId` so a later change can add side A without a new schema. A regression rule for absolute checks needs its own record.
2. The labels for the absolute basis (section 8). Tier 1 after approval.
3. The default check set and the retention of content snapshots stay with the owner (spec section 17). This record decides neither.

## What would change the pick

- A measured viewer cost far above the bound of 10 files. Then A, as a staged first step with the viewer unchanged, could win. It would still break R7.3, so it would need a spec edit that the owner directs.
- The owner rejects the optional `pair` schema break before 1.0. Then B fails R13.13, and A is the only option left. The owner would have to accept R7.3 as changed.
- A finding that a viewer file cannot show a `subject` report without a rewrite. Then the first view in section 9 needs a design of its own.
- A requirement that all absolute results regress against a baseline. That is a relative check by definition and does not need this change.

## What was not verified

- The viewer files were not opened. The viewer edit set is a bound, not a count of needed edits.
- No code ran against these examples. The three JSON examples are not validated by any validator.
- The review by Codex and by Claude (issue #99, acceptance) is part of the pull request workflow. It has not happened.
- The `docs/specification.md` section 17 list was not re-read in full. Only lines cited here were read.
- Prior use of `heading-outline` and the other content checks as absolute rules in a single-run context does not exist in code. The mapping is a design, not a measurement.
