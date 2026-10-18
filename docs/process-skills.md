# Process skills: design

Status: decided by the owner on 2026-10-18. Nothing in this document is built yet. Each skill and each check ships in its own pull request.

Decisions of 2026-10-18:

1. The process has three skills, split by purpose: `vision-check`, `milestone-run`, `milestone-report`.
2. Review records are pull request comments.
3. The script may merge a pull request itself when the full merge rule holds. Every Tier 3 item always goes to the owner.
4. The review gate is advisory only. The CI check `review-gate` shows a status and blocks nothing. The project does not enforce reviewer identity. All comments may come from one GitHub account. See "Trade-off of the advisory gate".

This document turns the loop in `docs/vision.md` ("Milestones and releases", "Review and merge") into three skills, a script and CI checks. It cites the vision and does not change the rule. It adds mechanisms that check and report on the rule. Most of them do not block a merge (see "Trade-off of the advisory gate"). A follow-up pull request syncs `AGENTS.md` and `docs/development-loop.md` with this design (see "Where the skills live"). Until that pull request merges, those two files describe the current practice.

## Principle

A skill is a short instruction that calls a script. An invariant that can fail a build belongs in CI. Orchestration belongs in a script. Reviewers state their evidence in their own comments. The pull request template holds only items that the author fills and a machine can check.

## The loop

| Step | Owner | Agent | Reviewers (Codex, Claude) | CI |
| --- | --- | --- | --- | --- |
| 1 | Defines the milestone and its checks | | | |
| 2 | | Writes one issue for each check and attaches it to the milestone | | |
| 3 | | Opens one draft pull request for each issue | | Runs on every push |
| 4 | | | Each reviews the head SHA in a fresh context and posts a review record | `review-gate` shows the state of the records. It blocks nothing |
| 5 | | Fixes findings in a new commit. Goes back to step 4 | | |
| 6 | Decides every Tier 3 item | Marks the draft ready, then merges, when the full merge rule holds (see "Merge rule map" and "Merge steps") | | Runs the checks |
| 7 | | Tags a dev version from `main` after a green cumulative run | | Runs the cumulative suite |
| 8 | Approves the milestone from the report. Tags every stable release | Writes the milestone report | | |

## Where the skills live

- Claude Code reads `.claude/skills/<name>/SKILL.md`.
- Codex reads `AGENTS.md`. Each skill also has a plain file at `docs/skills/<name>.md`. `AGENTS.md` links to it, so Codex can load it. The follow-up pull request confirms the Codex skill path before it builds anything.
- The script lives at `scripts/milestone/` and is plain Node (`NODE_REQUIRES: ">=20"`). Both agents call the same script.
- The follow-up pull request that builds the skills also edits `AGENTS.md` and `docs/development-loop.md` so that they name the skills, the review record, the `review-gate` check and the merge command.

## Merge rule map

Skill 2 (`milestone-run`) merges only when all items of the vision's merge rule hold. Each item has one checker. CI checks what a machine can decide, except the review items, which CI only shows. The script checks the same items again before it merges and is the only gate for the review items. A reviewer judges the rest.

| Item of the merge rule | Enforcer |
| --- | --- |
| Codex and Claude review independently and both approve | Script (gate). `review-gate` (CI, advisory) shows the same result. Both read the review records |
| Each review is bound to the SHA that merges | Script (gate) and `review-gate` (advisory). The record SHA must equal the head SHA. The script merges with `gh pr merge --match-head-commit <sha>`. A new push changes the head SHA and voids every earlier review |
| CI is green, including the checkable items | The script reads the state of every check at the head SHA: `Node 20`, `Node 22`, `Local screenshot pipeline` (all three in workflow `CI`) and `conventional-pr-title` (workflow `Lint PR Title`), `tier-3-gate` and `pr-fields-check`. `review-gate` is shown but the script decides from the records itself. These checks block a merge only after the owner creates the ruleset (see "Trade-off of the advisory gate") |
| The change is not a Tier 3 item | `tier-3-gate` (CI) for the categories it can detect. For all categories the script refuses when any counted record has `tier` 3 or `default_behavior` other than `none` (see "Record validation"). Reviewers judge the rest (see "Tier 3 coverage") |
| The author gives no decisive approval | Script (gate) and `review-gate` (advisory). No record counts when its reviewer field is `author`. The author is never one of the two reviewers |
| Each reviewer states the evidence examined and what it left unverified | Review record fields `evidence` and `unverified`. Script and `review-gate` fail when either field is empty |
| No security impact, no unexpected file, no missing test, no material risk | Reviewers state each one in the record (`security`, `unexpected_files`, `tests`, `risk`). CI checks the security-relevant paths and the presence of test files in the diff. Any finding goes to the owner, even when both reviewers agree |

Loop step 6 is this table. The agent does not merge on "both approve and CI is green" alone.

## Review record

A review record is one pull request comment. It starts with the marker line `<!-- test-kit-review -->` and holds one JSON block. Skill 1 (`vision-check`) in mode `pr` writes exactly this block. There is one schema for the skill output and the record.

```json
{
  "mode": "pr",
  "reviewer": "codex",
  "sha": "<40-character head SHA>",
  "verdict": "fits",
  "principle": 2,
  "tier": 1,
  "requirements": ["R7.3"],
  "default_behavior": "none",
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
- The record carries no run id. GitHub gives each comment an `id`, a `created_at` and an `updated_at`. The script and `review-gate` use these real values, not a value that the reviewer writes.
- The script and `review-gate` read only comments whose `author_association` is `OWNER`, `MEMBER` or `COLLABORATOR`. The repository is public, so a stranger can post a comment with the marker. A comment from any other association is ignored. It can neither count nor void a real record. `author_association` is a field that GitHub supplies. It is not identity enforcement (see "Trade-off of the advisory gate").
- The script and `review-gate` read only the latest such record of each reviewer, by comment `created_at`. An older record never counts.
- A record whose comment was edited (`updated_at` differs from `created_at`) does not count. The reviewer posts a new comment instead.
- Every field is required. "Record validation" lists the parse rules and the content rules. A record that breaks a parse rule is a fail.
- The record counts as an approval only when `verdict` is `fits` and every field is complete (see "Verdicts").
- Text in a record is untrusted input. Code parses it as data and never passes it to a shell or to an expression.

Who is who. The `reviewer` field names the reviewer. Nobody signs it:
- All comments may come from one GitHub account, because the agents may run under the owner's account. The comment author then does not tell Codex from Claude from the author. The project does not enforce reviewer identity (decision 4).
- The script requires two records with different `reviewer` values (`codex` and `claude`), two different comment ids, and no `author` value among the two. This catches a careless mistake. It does not catch a forged record.
- A reviewer that runs under its own GitHub account or app is allowed. The script then records the comment authors, so the audit can use them. It does not require them.
- The record cannot prove independence. The rule "a reviewer is never a fork of the author" stays a reviewer rule. The audit samples it (see "Audit sampling").

## Trade-off of the advisory gate

The owner chose this on 2026-10-18. The review gate is advisory only. Plainly:

- The CI check `review-gate` shows a status on the pull request. It blocks no merge. It is not a required check.
- The project does not enforce review identity. A comment that claims `"reviewer": "claude"` may come from any account, including the account of the author.
- A forged review is caught only by audit. CI does not catch it. A forged record from an account that has the association `OWNER`, `MEMBER` or `COLLABORATOR` (for example the shared account) counts. A forged record from a stranger is excluded, because only those three associations count. A missing review is not an audit matter: the script refuses to merge without both records.
- The script checks the records before it merges. The script is code that the same agent runs. So the control is the honesty of the agent, plus the audit sampling of the owner. Nothing else stops a dishonest or broken agent.
- The merge rule in `docs/vision.md` stays the rule. This design does not weaken it. It only says which part a machine enforces and which part rests on honesty and audit.
- Other checks are `Node 20`, `Node 22`, `Local screenshot pipeline`, `conventional-pr-title`, `tier-3-gate` and `pr-fields-check`. They are also advisory today. They block a merge only after the owner creates the ruleset below. Even then `tier-3-gate` and `pr-fields-check` only block what a machine can detect.
- A required check on `main` needs a ruleset. On 2026-10-18 `main` had no branch protection (the GitHub API returned 404) and the repository had no rulesets (the `rulesets` API returned `[]`). The owner creates the ruleset. Until it exists, no check blocks a merge. The ruleset lists these exact check names: `Node 20`, `Node 22`, `Local screenshot pipeline` (all three in workflow `CI`) and `conventional-pr-title` (workflow `Lint PR Title`), and then `tier-3-gate` and `pr-fields-check`. `review-gate` stays out of the list.

## Record validation

One module, `scripts/milestone/records.js`, parses and validates records. The merge script and the `review-gate` workflow both import it. The two parse the same way. They can still differ on content: `review-gate` applies the parse rules and the content rules that need only the records (`verdict`, `tier`, `default_behavior`, `security`, `unexpected_files`, `tests`, `risk`). It does not read the template or the diff. So the status can be `success` while the script refuses because of a template or diff rule. The script decides. The status description says "records ok; the script may still refuse". `review-gate` checks out the default branch only to load this module (this needs `contents: read`). It never checks out the pull request.

The module returns for each reviewer `counted` (true or false) and a reason. A record is counted only when all parse rules hold. The script then applies the content rules to the two counted records and to the template in the pull request body.

Parse rules (a failure means the record is not counted, which is a fail):
- Exactly one JSON block after the marker. All 15 fields of the schema exist with the right type.
- `sha` is 40 hex characters and equals the head SHA. The comment is unedited.
- `verdict` is `fits`, `needs-owner` or `conflicts`.
- `evidence`, `unverified`, `requirements` and `citations` are non-empty arrays of non-empty strings.
- Each `requirements` entry matches `R[0-9]+(\.[0-9]+)?` and exists in `docs/specification.md`. The only other accepted value is the single entry `"none"`. It means the change meets and changes no requirement (for example a CI-only or docs-only change). The template spells the same case `none: <reason>`.
- Each `citations` entry matches `path:line`. The path is a relative path in the repository.

Content rules (a failure means no merge and an owner question, even when the verdict is `fits`):

| Field | Accepted value for a merge | Other value |
| --- | --- | --- |
| `tier` | 1 or 2, and equal to the `tier` in the template | Owner question. `tier` 3 is always Tier 3 |
| `principle` | Equal to the `principle` in the template | Owner question |
| `requirements` | Equal, as a set, to `requirements` in the template. `["none"]` equals `none: <reason>` | Owner question |
| `default_behavior` | `none` | Owner question (Tier 3) |
| `security` | `none` | Owner question |
| `unexpected_files` | `none` | Owner question |
| `tests` | `present` or `docs-only`, and equal to `tests` in the template | Owner question |
| `risk` | `none` | Owner question |

The script also applies these rules to the template and the diff, which it reads itself. They do not depend on a label. The script refuses and writes an owner question when:
- `runtime_dependency` is not `none`, or the diff changes `dependencies` in `package.json` or the lockfile;
- `security_path` is not `none`, or the diff matches `scripts/milestone/security-paths.json` (read from the base branch);
- the diff touches `docs/vision.md`;
- `left_alone` is empty (see "Merge steps").

A Tier 3 item that only a reviewer sees (`tier` 3 or `default_behavior` other than `none` in a record) stops the merge, even when `tier-3-gate` saw nothing.

## Verdicts

| Verdict | Counts as |
| --- | --- |
| `fits` with a complete record | approve |
| `fits` with an incomplete or edited record | fail |
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

Output. In mode `pr` the output is the review record (see "Review record"). It has the same fields and the same names. In mode `issue` the output is the same JSON block with `"mode": "issue"`, and without `sha`, `evidence`, `unverified`, `unexpected_files` and `tests`. `review-gate` and the script ignore a block with `"mode": "issue"`.

The fields are the 15 fields of the JSON block in "Review record". "Record validation" gives the accepted values.

| Field | Meaning |
| --- | --- |
| mode | `pr` or `issue` |
| reviewer | `codex`, `claude` or `author` |
| sha | The head SHA that the review covers (mode `pr` only) |
| verdict | `fits`, `needs-owner` or `conflicts` |
| principle | The number of the principle the change serves |
| tier | 1, 2 or 3, from the vision |
| requirements | The R-numbers the change meets or changes |
| default_behavior | `none` or a description. Any new default is Tier 3 |
| evidence | What the reviewer examined (mode `pr` only) |
| unverified | What the reviewer did not verify (mode `pr` only) |
| security | `none` or the path and the reason |
| unexpected_files | `none` or the files |
| tests | `present`, `docs-only` or `none: <reason>` (mode `pr` only) |
| risk | `none` or the risk |
| citations | File and line for each claim |

`fits` is a cited judgement. It is never the only gate.

## Skill 2: `milestone-run`

Purpose: run the loop for one milestone until every check passes or a stop condition holds.

Input: the milestone name.

The skill calls a script that:
1. Lists the open issues of the milestone and their dependencies.
2. Starts one worktree and one draft pull request for each independent issue.
3. Starts the two reviews for each pull request at its head SHA.
4. Merges a pull request only when every item in "Merge rule map" holds, in the order of "Merge steps". It reads CI status, labels and review records from the GitHub API. It refuses on any parse error.
5. Stops and writes an owner question for each Tier 3 item, each failed review that repeats, and each material risk.

## Merge steps

The script runs these steps in this order. Any failure stops it with no change.

1. Read the head SHA. Read the review records, the labels and the check state at that SHA.
2. Check every item of "Merge rule map" and every rule of "Record validation". Stop when one fails. When a counted record fails a content rule (not a parse rule), write an owner question and do not merge.
3. Mark the draft ready: `gh pr ready <number>`. GitHub does not merge a draft. The pull request stays a draft until this step, as `AGENTS.md` requires. Only this script marks a pull request ready. An author agent never does.
4. Read the head SHA again. If it differs from step 1, run `gh pr ready --undo <number>` and stop. Start again at step 1 on the next run. Records, labels and the pull request body may also change between steps. The advisory design accepts that window. The merge in step 6 binds only to the head SHA. If any check fails after step 3, the script runs `gh pr ready --undo <number>` too, so the pull request is a draft again.
5. Wait for the checks at the head SHA. The script reads two APIs: check runs (the CI jobs) and commit statuses (`tier-3-gate`, `pr-fields-check`, `review-gate`). `ci.yml` and `pr-title.yml` do not list the `ready_for_review` event, so marking ready starts no new run of them (unverified for GitHub defaults; the script reads the check state that exists at the head SHA and waits only for checks still pending).
6. Merge: `gh pr merge <number> --squash --match-head-commit <sha> --subject "<pull request title> (#<number>)" --body-file <file>`. The script passes the subject and the body itself, because the default squash message does not carry the commit body that `AGENTS.md` requires (what was rejected or left alone). The script appends " (#<number>)" itself. GitHub's default squash subject is the title plus that suffix (unverified whether `--subject` drops it, so the script sets it). The body comes from the template field `left_alone` (what the change rejected or left alone) and the `risk` fields of the two records. `pr-fields-check` requires `left_alone` to be non-empty text or `none`. GitHub refuses the merge if a push arrived after step 4.
7. Write the merge to the milestone log: PR number, head SHA, comment ids of the two records, check state.

The script may merge itself (owner decision of 2026-10-18). Every Tier 3 item always goes to the owner. The script never merges a Tier 3 item, even when the label is present. The owner merges it.

Stop conditions are the vision's "Stop conditions". The skill adds none.

## Skill 3: `milestone-report`

Purpose: write the report the owner reads before approving a milestone.

Output: one page with the sections "Merged", "Waiting for the owner", "Verified", "Not verified", "Risks". Every claim links a pull request, a CI run or a file. "Verified" lists only what ran, each with its command or CI run. A check that did not run goes to "Not verified".

## CI checks and a template

These replace skill text where a machine can decide.

A pull request template holds fields that the author fills and that CI can check. It holds no reviewer evidence. Reviewers write evidence in their records.

### Template fields and their checker

`pr-fields-check` (a status check; required only after the ruleset exists) reads the template from the pull request body and the diff from the API. It never runs code from the pull request. Trigger: `pull_request_target` with types `opened`, `edited`, `synchronize`, `reopened` and `ready_for_review`. Permissions: `contents: read`, `pull-requests: read`, `statuses: write`. It runs from the base branch and reads `scripts/milestone/security-paths.json` from the base branch, because a pull request could edit that list. Each field has one checker:

| Field | Value | Checker and rule |
| --- | --- | --- |
| `tier` | 1, 2 or 3 | `pr-fields-check`. The value must be 1, 2 or 3. It must be 3 when `tier-3-gate` detects a Tier 3 category. The script compares it with the record (see "Record validation") |
| `principle` | A number | `pr-fields-check`. The number must be a principle number in the "Principles" list of `docs/vision.md`. The script counts the list. The script compares it with the record |
| `requirements` | R-numbers or `none: <reason>` | `pr-fields-check`. Each R-number must exist in `docs/specification.md`. `none` needs a reason. The script compares the set with the record |
| `default_behavior` | `none` or a description | Reviewers. CI checks only that the field is present. A value other than `none` makes the change Tier 3, and the script does not merge it |
| `runtime_dependency` | `none` or a package name | `pr-fields-check`. It diffs `dependencies` in `package.json` and the lockfile. The field must name every added runtime package, or be `none` when the diff adds none |
| `tests` | `present`, `docs-only` or `none: <reason>` | `pr-fields-check`. `present` needs a changed file under `tests/` or a `*.test.js` file. `docs-only` needs a diff that touches only `docs/` and `*.md` files. `none` goes to the owner. The script compares the value with the record |
| `left_alone` | Text or `none` | `pr-fields-check`. The field must exist and be non-empty. The script copies it to the commit body. Reviewers judge its truth |
| `security_path` | `none` or a list of paths | `pr-fields-check`. It matches the diff against the list in `scripts/milestone/security-paths.json` (for example `.github/workflows/`, `scripts/milestone/`, `src/capture/`, `viewer/`). The field must list every match |

### Review gate

`review-gate` (advisory status, not required). It shows the review state on the pull request. It blocks nothing (decision 4).

Trigger. The workflow `.github/workflows/review-gate.yml` runs on two events:
- `issue_comment` with types `created`, `edited` and `deleted`. It acts only when `github.event.issue.pull_request` is set.
- `pull_request_target` with types `opened`, `synchronize`, `reopened` and `ready_for_review`. Every event recomputes the status from the records at the current head SHA. After a push there is no record for the new SHA, so the status is `pending`. `ready_for_review` recomputes the same way. It does not reset the status.

Both events run the workflow file from the default branch. The workflow does not check out the pull request. It does not run code from the pull request. It reads the comments and the head SHA through the GitHub API, parses each record as data, and writes a commit status named `review-gate` on the head SHA through the commit status API (permissions `contents: read` for the checkout of the default branch, `statuses: write`, `pull-requests: read` and `issues: read` for the comments; no other). It sets `success` only when the latest counted `codex` record and the latest counted `claude` record each are complete, unedited, have the verdict `fits` and carry the current head SHA. Otherwise it sets `failure` or `pending` and writes the reason in the status description.

### Tier 3 gate

`tier-3-gate` (a status check; required only after the ruleset exists). It fails when the pull request touches a Tier 3 category that CI can detect and the pull request lacks a valid approval label (see below).

Label rules for `tier-3-approved` and `dependency-approved`:
- Only the owner may apply them. The check reads the labeler from the issue events API (`actor` of the `labeled` event) and ignores a label that another actor applied. This binds to a GitHub account, not to a person. If an agent runs under the owner's account, it can apply the label. The audit covers this.
- The label binds to the head SHA. Two guards apply:
  1. The workflow removes the label on every `synchronize` event. A new push voids the label. The owner applies it again. This is the main guard. It depends on the workflow running in time.
  2. On every `synchronize` event the workflow writes a `pending` commit status named `tier-3-gate` on the new head SHA. GitHub sets the `created_at` of that status. The check accepts the label only when its `labeled` event is later than the `created_at` of the first `tier-3-gate` status on the head SHA, and later than any `head_ref_force_pushed` event in the pull request timeline. This is the latest `synchronize` event that the workflow saw. It is not the true push time.
- The check does not use the commit date or the author date (the author sets them). It does not use the repository Events API (at most 300 events and 30 days, about 9 days of window measured in this repository, lag of hours). It does not use the earliest check suite of the SHA: GitHub reuses one suite for each app and SHA, so a commit pushed to several branches keeps the first suite time.
- Limits (unverified, not yet run): the status time is later than the true push time by the delay of the workflow start. A label applied inside this gap is rejected, which fails closed. If the workflow is late or the status is missing, the check ignores the label and the owner applies it again after the status exists. A late source delays a Tier 3 approval. It never grants one. A push without a `synchronize` run (for example Actions disabled) leaves the label valid. The script then also compares the label time with the commit list of the pull request and refuses when unsure.
- The check runs from the base branch. It uses `pull_request_target`, or a required workflow or ruleset, so the pull request cannot edit the check that judges it. The workflow does not check out or run code from the pull request head.
- The check blocks a merge only after the ruleset from "Trade-off of the advisory gate" exists.
- The check triggers on `opened`, `reopened`, `ready_for_review`, `edited`, `labeled`, `unlabeled` and `synchronize`, so a new pull request gets a status. Every required-check workflow lists at least `opened`, `reopened`, `synchronize` and `ready_for_review`.
- Permissions: `contents: read` (to load `records.js`), `statuses: write`, `pull-requests: write` (to remove a label) and `issues: read` (for the label events). The default token of this repository is read-only (`default_workflow_permissions` is `read`, checked 2026-10-18), so the workflow file must declare these permissions.

### Stable tag protection

Only the owner may create a stable release tag (decision of 2026-10-16). A repository tag ruleset would enforce it once the owner creates it. It does not exist today:
- Target: tags that match `v*`. Exclude `v*-dev.*`, because the agent may tag dev versions.
- Rules: restrict creation, update and deletion.
- Bypass list: the owner only.
- `release.yml` runs on stable tags only (`v[0-9]+.[0-9]+.[0-9]+`, checked on `main` after PR #110). A dev tag starts no Release run (R13.26). `release.yml` does not decide who may tag. The ruleset does.
- Precondition in the vision ("Milestones and releases", item 6): the agent tags nothing until the spec edit #100 merges. #100 is closed, so the agent may tag dev versions after a green cumulative run.
- The ruleset does not exist yet (see "Trade-off of the advisory gate").
- Limit: a ruleset binds a GitHub account. If the agent runs under the owner's account, the ruleset does not stop it. Then the rule "the agent never tags a stable release" rests on the honesty of the agent. The audit checks every stable tag against the milestone report.

## Audit sampling

Review identity and the labels are not enforced, so the owner audits on sample. The audit is how the owner finds a forged or missing review.

Sample size. For each milestone, the milestone report lists every merged pull request. A fixed public rule is predictable, so the agent could compute the sample in advance. The owner adds a salt that the owner picks after the last merge of the milestone, and recomputes the sample:
- Always: every pull request that touched a security path, every pull request merged while `review-gate` was not `success`, and every stable tag.
- Plus a random sample of the other pull requests: `max(2, ceil(10% of them))`. The owner runs the script with the salt. It sorts them in ascending order by the hex SHA-256 of `<salt>:<pull request number>`, breaks a tie by the lower pull request number, and takes the first ones.

Cost. The owner needs about 10 minutes for one pull request. This is an estimate, not a measurement. The first milestone measures the real time, and this document then states the measured value.

How to re-check one pull request. The owner does these steps in the GitHub web interface:
1. Open the pull request. Confirm that two record comments exist, with `reviewer` values `codex` and `claude`, and no edit mark.
2. Compare the `sha` in each record with the last commit of the pull request before the merge. They must be equal.
3. Compare the comment times with the sessions of the two reviewers (the Codex and Claude session logs). A record without a matching session is suspect.
4. Pick one citation (`path:line`) in each record. Open it at the head SHA. The line must support the claim.
5. For a Tier 3 label, open the pull request timeline. The `labeled` event must come from the owner and be later than the last push.

Result. A failed re-check is a material risk. The owner stops auto-merge for the milestone until the cause is known.

## Tier 3 coverage

The vision lists seven Tier 3 categories. The table splits one of them ("a stable release tag, and a merge of a milestone into `main`") into two rows. CI detects two categories (`docs/vision.md` and runtime dependencies). Reviewers judge the rest. A category that only reviewers judge goes to the owner through the record fields (`needs-owner`) and through the rule that the script never merges a Tier 3 item.

| Tier 3 category (`docs/vision.md`) | Detected by |
| --- | --- |
| Any change to `docs/vision.md` | CI: diff of that file |
| A change to a principle, goal or non-goal | Reviewers. CI sees it only when the change is in `docs/vision.md` |
| A new runtime dependency | CI: diff of the `dependencies` field in `package.json` and of the lockfile |
| A change to a default, to retention, or to the default check set | Reviewers (the record field `default_behavior`) |
| A stable release tag | Not detected by a workflow: `release.yml` runs after the tag exists. The control is the tag ruleset, which does not exist yet. The script never pushes a stable tag. The audit checks every stable tag |
| A merge of a milestone into `main` | Does not apply. There is no milestone branch (vision, "Milestones and releases"). Each pull request merges into `main` on its own |
| An edit of an issue the owner created | Reviewers only. Neither CI nor the script sees issue edits. The audit and the owner's own notification of issue edits are the control |
| Anything that sends data off the machine | Reviewers |

A `devDependencies` change is not a runtime dependency. CI does not require `dependency-approved` for it. The reviewers still list it under `unexpected_files` or `risk` when it is more than a routine update, and the owner sees it in the report. A pull request that adds any dependency states the result of a security check: known vulnerabilities, last release, maintenance state.

## Proposed edit of `AGENTS.md`

`AGENTS.md` ("PR + Review workflow") and the vision merge rule must say the same. This design does not edit `AGENTS.md`. The follow-up pull request that builds the skills applies this text. It replaces the first bullet of the section:

> - One logical change for each pull request. A pull request is a draft, assigned to `parisek`. The owner authorizes autonomous review and merge of low-risk changes (2026-10-09; process details 2026-10-18). A change merges when the merge rule in `docs/vision.md` holds: two independent reviews (Codex and Claude) bound to the head SHA, green checks, no Tier 3 item, and no security impact, unexpected file, missing test or material risk. The merge script `scripts/milestone/` checks the review records, marks the draft ready and merges. An author agent never marks its own pull request ready and never approves it. The CI check `review-gate` is advisory. The owner audits a sample of merged pull requests (`docs/process-skills.md`, "Audit sampling"). Send a problem or material risk to the owner for approval. The owner approves every milestone and every stable release.

The text keeps three existing facts: draft pull requests, assignment to `parisek`, and escalation of risks. It replaces "independent review must pass" with the exact rule. It also names who marks a pull request ready, which `AGENTS.md` leaves open today.

## Not decided

The decisions of 2026-10-18 close the earlier open questions. One point stays for the follow-up pull request. It does not change a decision.

- The exact path from which Codex loads a skill file.
