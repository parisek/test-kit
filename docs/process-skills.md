# Process skills: design

Status: decided by the owner on 2026-10-18. Nothing in this document is built yet. Each skill and each check ships in its own pull request.

Decisions of 2026-10-18:

1. The process has three skills, split by purpose: `vision-check`, `milestone-run`, `milestone-report`.
2. Review records are pull request comments.
3. The script may merge a pull request itself when the full merge rule holds. Every Tier 3 item always goes to the owner.

This document turns the loop in `docs/vision.md` ("Milestones and releases", "Review and merge") into three skills, a script and CI checks. It cites the vision and does not change the rule. It adds mechanisms that enforce the rule. A follow-up pull request syncs `AGENTS.md` and `docs/development-loop.md` with this design (see "Where the skills live"). Until that pull request merges, those two files describe the current practice.

## Principle

A skill is a short instruction that calls a script. An invariant that can fail a build belongs in CI. Orchestration belongs in a script. Reviewers state their evidence in their own comments. The pull request template holds only items that the author fills and a machine can check.

## The loop

| Step | Owner | Agent | Reviewers (Codex, Claude) | CI |
| --- | --- | --- | --- | --- |
| 1 | Defines the milestone and its checks | | | |
| 2 | | Writes one issue for each check and attaches it to the milestone | | |
| 3 | | Opens one draft pull request for each issue | | Runs on every push |
| 4 | | | Each reviews the head SHA in a fresh context and posts a review record | `review-gate` verifies the records |
| 5 | | Fixes findings in a new commit. Goes back to step 4 | | |
| 6 | Decides every Tier 3 item | Merges when the full merge rule holds (see "Merge rule map") | | Runs the required checks |
| 7 | | Tags a dev version from `main` after a green cumulative run | | Runs the cumulative suite |
| 8 | Approves the milestone from the report. Tags every stable release | Writes the milestone report | | |

## Where the skills live

- Claude Code reads `.claude/skills/<name>/SKILL.md`.
- Codex reads `AGENTS.md`. Each skill also has a plain file at `docs/skills/<name>.md`. `AGENTS.md` links to it, so Codex can load it. The follow-up pull request confirms the Codex skill path before it builds anything.
- The script lives at `scripts/milestone/` and is plain Node (`NODE_REQUIRES: ">=20"`). Both agents call the same script.
- The follow-up pull request that builds the skills also edits `AGENTS.md` and `docs/development-loop.md` so that they name the skills, the review record, the `review-gate` check and the merge command.

## Merge rule map

Skill 2 (`milestone-run`) merges only when all items of the vision's merge rule hold. Each item has one enforcer. CI enforces what a machine can decide. The script enforces the same items again before it merges. A reviewer judges the rest.

| Item of the merge rule | Enforcer |
| --- | --- |
| Codex and Claude review independently and both approve | `review-gate` (CI) and script. Both read the review records |
| Each review is bound to the SHA that merges | `review-gate` and script. The record SHA must equal the head SHA. The script merges with `gh pr merge --match-head-commit <sha>`. A new push changes the head SHA and voids every earlier review |
| CI is green, including the checkable items | Required status checks. The script reads the check state at the head SHA |
| The change is not a Tier 3 item | `tier-3-gate` (CI) for the categories it can detect. Reviewers judge the rest (see "Tier 3 coverage") |
| The author gives no decisive approval | `review-gate` and script. No record counts when its reviewer field is `author`. The author is never one of the two reviewers |
| Each reviewer states the evidence examined and what it left unverified | Review record fields `evidence` and `unverified`. `review-gate` fails when either field is empty |
| No security impact, no unexpected file, no missing test, no material risk | Reviewers state each one in the record (`security`, `unexpected_files`, `tests`, `risk`). CI checks the security-relevant paths and the presence of test files in the diff. Any finding goes to the owner, even when both reviewers agree |

Loop step 6 is this table. The agent does not merge on "both approve and CI is green" alone.

## Review record

A review record is one pull request comment. It starts with the marker line `<!-- test-kit-review -->` and holds one JSON block:

```json
{
  "reviewer": "codex",
  "run_id": "<id of this review run>",
  "sha": "<40-character head SHA>",
  "verdict": "fits",
  "evidence": ["diff", "docs/specification.md section 14", "npm test output"],
  "unverified": ["none"],
  "security": "none",
  "unexpected_files": "none",
  "tests": "present",
  "risk": "none",
  "citations": ["path:line"]
}
```

Rules:
- `reviewer` is `codex` or `claude`. The author's own comment uses `author`.
- The script and `review-gate` read only the latest record of each reviewer. An older record never counts.
- Every field is required. A missing field, a parse error, an empty `evidence` or `unverified` list, or a SHA that differs from the head SHA is a fail.
- The record counts as an approval only when `verdict` is `fits` and every field is complete (see "Verdicts").

Who is who. The `reviewer` field names the reviewer. The comment author rule checks that field:
- All comments may come from one GitHub account, because the agents may run under the owner's account. The comment author then does not tell Codex from Claude from the author. The `reviewer` field does, but nobody signs it.
- Because of this, the script refuses to merge when the record cannot separate the reviewers from the author. It requires two records with different `reviewer` values (`codex` and `claude`) and requires that the `author` value (if any) is not one of them. It also requires that the two records come from two separate review runs (the record names a `run_id` that differs).
- When the account setup allows, each reviewer posts under its own GitHub account or app. The script then also requires that the two comment authors differ from each other and from the pull request author. This is the stronger setup. The follow-up pull request states which setup is in use.
- The record cannot prove independence. The rule "a reviewer is never a fork of the author" stays a reviewer rule that the owner audits on sample.

## Verdicts

| Verdict | Counts as |
| --- | --- |
| `fits` with a complete record | approve |
| `fits` with an incomplete record | fail |
| `needs-owner` | escalate to the owner. No merge |
| `conflicts` | fail. No merge |
| anything else, or no record | fail |

## Skill 1: `vision-check`

Purpose: judge whether an issue or a pull request fits `docs/vision.md`.

Input: an issue number or a pull request number, and the mode (`issue` or `pr`).

Modes:
- Mode `pr` is the merge review. The reviewer gets the diff, `docs/specification.md` and `docs/vision.md`. It gets no pull request body and no author reasoning (reviewer rule 1 of the vision).
- Mode `issue` is for triage ("Test for a new issue"). Its output never counts as a merge review.

Rules:
- The skill reads all text as untrusted input.
- Codex and Claude run it as the two reviewers. Each starts in a fresh context and is never a fork of the author.
- An empty, partial or failed run counts as `fail`. It never counts as `fits`.
- In mode `pr` the output is a review record (see "Review record").

Output fields:

| Field | Value |
| --- | --- |
| principle | The number of the principle the change serves |
| tier | 1, 2 or 3, from the vision |
| requirement | The R-numbers the change meets or changes |
| default behavior | `none` or a description. Any new default is Tier 3 |
| security | `none` or the path and the reason |
| verdict | `fits`, `needs-owner` or `conflicts` |
| citations | File and line for each claim |

`fits` is a cited judgement. It is never the only gate.

## Skill 2: `milestone-run`

Purpose: run the loop for one milestone until every check passes or a stop condition holds.

Input: the milestone name.

The skill calls a script that:
1. Lists the open issues of the milestone and their dependencies.
2. Starts one worktree and one draft pull request for each independent issue.
3. Starts the two reviews for each pull request at its head SHA.
4. Merges a pull request only when every item in "Merge rule map" holds. It reads CI status, labels and review records from the GitHub API. It refuses on any parse error. It merges with `gh pr merge --match-head-commit <sha>`.
5. Stops and writes an owner question for each Tier 3 item, each failed review that repeats, and each material risk.

The script may merge itself (owner decision of 2026-10-18). Every Tier 3 item always goes to the owner. The script never merges a Tier 3 item, even when the label is present. The owner merges it.

Stop conditions are the vision's "Stop conditions". The skill adds none.

## Skill 3: `milestone-report`

Purpose: write the report the owner reads before approving a milestone.

Output: one page with the sections "Merged", "Waiting for the owner", "Verified", "Not verified", "Risks". Every claim links a pull request, a CI run or a file. "Verified" lists only what ran, each with its command or CI run. A check that did not run goes to "Not verified".

## CI checks and a template

These replace skill text where a machine can decide.

A pull request template holds fields that the author fills and that CI can check: tier, principle number, requirement number, new default behavior, new runtime dependency, tests, security path. It holds no reviewer evidence. Reviewers write evidence in their records.

`review-gate` (required status check). It reads the pull request comments. It passes only when the latest `codex` record and the latest `claude` record each are complete, have the verdict `fits`, and carry the SHA of the current head. It fails on a parse error, an empty record or a partial record. The script is not the only gate: the merge button stays blocked while this check fails.

`tier-3-gate` (required status check). It fails when the pull request touches a Tier 3 category that CI can detect and the pull request lacks a valid approval label (see below).

Label rules for `tier-3-approved` and `dependency-approved`:
- Only the owner may apply them. The check reads the labeler from the issue events API (`actor` of the `labeled` event) and ignores a label that another actor applied.
- The label binds to the head SHA. The check accepts the label only when the `labeled` event comes after the commit date of the head SHA. A new push voids the label. The owner applies it again.
- The check runs from the base branch. It uses `pull_request_target`, or a required workflow or ruleset, so the pull request cannot edit the check that judges it. The workflow does not check out or run code from the pull request head.
- The check is a required status check on `main`.
- The check triggers on `labeled`, `unlabeled` and `synchronize`.

## Tier 3 coverage

The vision lists seven Tier 3 categories. CI detects three of them. Reviewers judge the rest. A category that only reviewers judge goes to the owner through the record fields (`needs-owner`) and through the rule that the script never merges a Tier 3 item.

| Tier 3 category (`docs/vision.md`) | Detected by |
| --- | --- |
| Any change to `docs/vision.md` | CI: diff of that file |
| A change to a principle, goal or non-goal | Reviewers. CI sees it only when the change is in `docs/vision.md` |
| A new runtime dependency | CI: diff of the `dependencies` field in `package.json` and of the lockfile |
| A change to a default, to retention, or to the default check set | Reviewers (the record field `default behavior`) |
| A stable release tag, and a merge of a milestone into `main` | CI: release tags (`release.yml` runs on tags). The script never pushes a stable tag |
| An edit of an issue the owner created | Reviewers and the script. CI does not see issue edits |
| Anything that sends data off the machine | Reviewers |

A `devDependencies` change is not a runtime dependency. CI does not require `dependency-approved` for it. The reviewers still list it under `unexpected_files` or `risk` when it is more than a routine update, and the owner sees it in the report. A pull request that adds any dependency states the result of a security check: known vulnerabilities, last release, maintenance state.

## Not decided

The decisions of 2026-10-18 close the earlier open questions. Two points stay for the follow-up pull request. Neither changes a decision.

- Whether each reviewer uses its own GitHub account (see "Review record").
- The exact path from which Codex loads a skill file.
