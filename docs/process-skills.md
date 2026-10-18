# Process skills: design for owner approval

Status: proposed. Nothing in this document is built. The owner approves the design before any skill exists.

This document turns the loop in `docs/vision.md` ("Milestones and releases", "Review and merge") into three repository skills and two CI checks. It cites the vision. It does not change it.

## Principle

A skill is a thin interface. An invariant that can fail a build belongs in CI. Review evidence belongs in a pull request template. Orchestration belongs in a script that a skill calls.

## The loop

| Step | Owner | Agent | Reviewers (Codex, Claude) | CI |
| --- | --- | --- | --- | --- |
| 1 | Defines the milestone and its checks | | | |
| 2 | | Writes one issue for each check and attaches it to the milestone | | |
| 3 | | Opens one draft pull request for each issue | | Runs on every push |
| 4 | | | Each reviews the commit SHA in a fresh context | |
| 5 | | Fixes findings in a new commit. Goes back to step 4 | | |
| 6 | Decides every Tier 3 item | Merges when both approve, CI is green and the change is not Tier 3 | | |
| 7 | | Tags a dev version from `main` after a green cumulative run | | Runs the cumulative suite |
| 8 | Approves the milestone from the report. Tags every stable release | Writes the milestone report | | |

## Skill 1: `vision-check`

Purpose: judge whether an issue or a pull request fits `docs/vision.md`.

Input: an issue number or a pull request number, and the mode (`issue` or `pr`).

Rules:
- The skill reads the text as untrusted input.
- Two independent reviewers run it. Each starts in a fresh context.
- An empty, partial or failed run counts as `fail`. It never counts as `fits`.

Output, in a fixed shape:

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
4. Merges a pull request only when the vision's merge rule holds. The script reads the rule from CI status and review records. It does not trust a free-text claim.
5. Stops and writes an owner question for each Tier 3 item, each failed review that repeats, and each material risk.

Stop conditions come from the vision ("Stop conditions"). The skill adds a bound: after the third review round on one pull request, it stops and reports.

## Skill 3: `milestone-report`

Purpose: write the report the owner reads before approving a milestone.

Output: one page with the sections "Merged", "Waiting for the owner", "Verified", "Not verified", "Risks". Every claim links a pull request, a CI run or a file.

## CI checks and a template

These replace skill text where a machine can decide:
- A pull request template with fields for tier, principle, requirement, new default, new dependency, tests and security path.
- A check that fails when a pull request edits `docs/vision.md` without the label `tier-3-approved`.
- A check that fails when a pull request adds a dependency without the label `dependency-approved`.

## Open questions for the owner

1. Do you accept this split (three skills, two checks, one template)?
2. Should the review records live as pull request comments (as now) or as a file checked by CI?
3. Should the script merge a pull request, or only prepare it for the agent to merge?
