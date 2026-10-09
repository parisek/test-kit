# Proposed issue backlog

Status: accepted planning structure. IDs below are planning IDs.
Changes to the specification also update the parent issue in the same step.

Roadmap: [#5](https://github.com/parisek/test-kit/issues/5).
Release sub-issues: [0.1.0](https://github.com/parisek/test-kit/issues/6),
[0.2.0](https://github.com/parisek/test-kit/issues/7),
[0.3.0](https://github.com/parisek/test-kit/issues/8),
[0.4.0](https://github.com/parisek/test-kit/issues/9),
[0.5.0](https://github.com/parisek/test-kit/issues/10).
TK-01 through TK-18 map to GitHub issues #11 through #28 in order.
The bootstrap infrastructure issue #3 also belongs to 0.1.0.

| ID | Proposed title | Depends on | Acceptance evidence |
| --- | --- | --- | --- |
| TK-01 | docs(contracts): define incomplete runs and comparison states | Owner decisions | Examples cover missing targets, capture failure, HTTP failure, unknown noise floor, and rule scope. R6.1, R8.1–R8.5, R9.4. |
| TK-02 | docs(migration): map visual helper dependencies and project overrides | None | Import graph covers visual, behavior, and lint consumers. Document aliases and both CMS theme roots. R13.9–R13.11, R13.43. |
| TK-03 | test(integration): add a synthetic site and isolated DDEV pilot recipe | None | Known visual change, redirect, error, and delayed asset are reproducible. No client data. Record host/container execution. R4.2, R12.4. |
| TK-04 | feat(report): add shared report validation and classification | TK-01 | Viewer and Node use the same pure logic. Unsafe paths and incomplete data are covered. R4.4, R9.1, R11.6. |
| TK-05 | feat(viewer): integrate the prototype and validate v1 reports | TK-03, TK-04 | A legacy report produced on the synthetic site loads without dropped evidence. Phone, keyboard, theme, and blocked storage checks pass. R9.1, R10.6–R10.9. |
| TK-06 | feat(config): resolve sides targets and frozen run settings | TK-01, TK-02 | Explicit target list, viewport list, settle recipe, and safe paths work from both theme roots. R5.4, R6.4, R12.1. |
| TK-07 | feat(capture): capture screenshots into complete or partial runs | TK-03, TK-06 | Stable A/A capture, intentional A/B change, interrupted run, and per-target error retain evidence. R4.1–R4.2, R6.4. |
| TK-08 | feat(compare): compare screenshot runs and retain full-resolution evidence | TK-04, TK-07 | Original images remain intact. Regions have pixel units. Unknown stability is explicit. R8.1–R8.3, R11.3. |
| TK-09 | feat(query): serve reports and return a bounded summary | TK-05, TK-08 | One pair produces equal classes in viewer and CLI. Measure output bytes. Include omitted counts and next actions. R11.1–R11.6. |
| TK-10 | chore(release): verify package contents and git installation in DDEV | TK-09, licence | Executable and exports work from the installed package. Validate release workflow failure cases and main ancestry before the first tag. R13.24–R13.31. |
| TK-11 | feat(migration): prepare skeleton dependency and compatibility aliases | TK-02, TK-10, owner tag | Parent and both CMS skeletons keep old command behavior. Sync and verify understand the pinned dependency before removal. R4.3, R13.7–R13.11. |
| TK-12 | feat(artifacts): capture and compare stored HTML and HTTP status | TK-09 | Reuse navigation response. Keep raw evidence. Make HTTP failure visible in both outputs. R4.2, R6.1, R6.4. |
| TK-13 | feat(rules): add evidenced normalization and pair-scoped known differences | TK-01, TK-12 | A rule outside scope cannot hide a difference. Evidence is mandatory. Original data stays available. R5.2–R5.3, R8.2–R8.6. |
| TK-14 | feat(checks): run starter checks over stored content | TK-12, defaults and retention decisions | A new check runs without a crawl. Version mismatch is explicit. Distinguish decorative empty alt from missing alternatives. Define link coverage. R7.1–R7.6. |
| TK-15 | feat(behavior): move the runner while retaining project contracts | TK-02, TK-11, contract ownership decision | Existing project discovery and allowlists work. Failed steps retain results and evidence. R6.2–R6.3, R13.41–R13.43. |
| TK-16 | feat(lint): export compatible ESLint and Stylelint entry points | TK-02, TK-11, entry-point design | Existing rule IDs, namespace, overrides, disable comments, and baselines work. Browser capture dependencies are not required for lint use. R13.40, R13.43. |
| TK-17 | feat(perf): measure repeated Lighthouse runs with comparability guards | TK-09, performance decisions | Warm-up, load guard, median, spread, incompatible settings, and budget exit behavior are measured. R6.5–R6.12. |
| TK-18 | feat(workflow): integrate agent queries with the update workflow | TK-11, artifact query milestones | An update obtains scoped evidence and reports unresolved changes. The workflow does not accept a difference without evidence. R5.3, R11.5. |

Track the backlog as root issue, release sub-issues, and implementation sub-issues.
Native blocked-by links express the dependencies in the table.
Split an implementation issue further if it contains independent behavior.
TK-11 requires separate repository PRs. Link them to one migration issue.
Do not merge removal before the pinned package release exists.

## Planned release outcomes

| Milestone | Work | Usable result |
| --- | --- | --- |
| 0.1.0 | TK-01–TK-10 | Local screenshot capture, compare, viewer, summary, and verified package installation. |
| 0.2.0 | TK-11–TK-13 | Project adoption, HTML/status evidence, and explained differences. |
| 0.3.0 | TK-14–TK-15 | Stored content checks and behavior evidence. |
| 0.4.0 | TK-16 | Compatible lint entry points. |
| 0.5.0 | TK-17–TK-18 | Speed evidence and the agent update workflow. |

The owner creates each release tag after its acceptance evidence passes.
Milestones are a plan, not a schedule. Use PATCH releases for fixes between them.
The first milestone may split further if integration evidence calls for it.

## Issue body template

```text
Problem:
Requirements:
Scope:
Exclusions:
Dependencies (must be merged):
Owner decisions:
Project compatibility:
Acceptance examples:
Validation commands:
Evidence:
```
