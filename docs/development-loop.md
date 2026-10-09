# Development loop proposal

Status: accepted development plan. Specification reconciliation is a separate task.
Requirements: R4.4, R11.6, R12.4, R13.9–R13.11, R13.24–R13.31.

## First usable result

A project captures a small target list before and after a change. The package
compares the two stored runs. The viewer and `summary` show the same classes.
They also show missing evidence and capture errors. A failed capture never
becomes a match. The old project commands call the package through thin aliases.

Start with screenshots. Add HTML and status after this flow works. Keep behavior,
content, speed, and lint migration in separate milestones. Do not rewrite the
existing engine without a dependency audit and a compatibility test.

## Evidence from the local skeletons

Inspected on 2026-10-09: the package manifests of `tailwind-base`,
`wordpress-base`, and `drupal-base` expose the same main visual commands and
behavior commands. The Drupal theme root and WordPress theme root differ.
The package must resolve paths from project configuration. It must not infer a
CMS from a directory name.

The upstream DDEV doctrine puts package installation and builds in the web
container. Playwright uses a browser on the host and visits the DDEV URL.
Mutagen must flush before a capture can record an edited container render.
The local DDEV inventory succeeds outside the restricted sandbox. No CMS smoke
test has run yet. No client report is copied into this repository.

## Test infrastructure

- Pure logic: Node tests, no browser, no network. Keep Node 20 support.
- Engine integration: a synthetic local HTTP site with known changes, redirects,
  failures, animation, and a delayed asset. Use Chromium on the host.
- Viewer integration: load reports produced by that engine. Test v1 adaptation,
  unsafe data, phone width, keyboard use, and blocked storage.
- CMS integration: one isolated WordPress skeleton and one Drupal skeleton in
  DDEV. Use synthetic content. Test installation and commands from each theme.
- Migration integration: verify aliases, project overrides, helper imports,
  manifest changes, and skeleton sync. Compare old and new outputs on the same
  synthetic targets. Record deliberate output changes.

Use one package checkout and separate disposable CMS worktrees. A DDEV project
gets a unique name per worktree. Do not reuse a live project's database. Start
only the environment needed for the current test. Stop only environments that
the loop starts. Do not reset Mutagen or import a database as a routine retry.

Before a tag, test `npm pack` contents, the installed executable, package exports,
and a Git install in DDEV. A package link can shorten local edits, but it does
not prove that a release installs. Test the git-tag path separately.

## Issue contract

Each issue contains: problem, numbered requirements, scope, exclusions,
dependencies, decision gates, compatibility surface, acceptance examples,
test commands, and evidence to retain. Each issue has one logical draft PR.
An issue is eligible for standalone work when its decisions are resolved and
dependencies are merged. A draft PR does not satisfy a dependency. Dependent
layers may develop together in a native stack under the rules below.

Suggested states: proposed, ready, active, review, awaiting-owner, blocked, done.
Use these as an agreed convention before adding labels or editing issues.
Use the parallel waves in `issue-backlog.md`. Run up to three workers and one
coordinator in the current four-slot environment. Reduce concurrency when review
needs a slot. This limit describes available slots, not measured speed gains.
Keep a small queue of independent issues when a dependency waits for owner merge.

## Subagent coordination

The coordinator selects eligible issues and assigns one worktree and issue to
each worker. A worker owns its implementation diff. Review uses a separate agent.
Do not share an editing checkout between workers. Do not start duplicate workers
on the same issue. The coordinator reconciles GitHub state before dispatch.

Agree on public contracts before parallel consumers implement them. Workers flag
contract changes to the coordinator. Shared files such as `package.json`, CLI
registration, lockfiles, and the specification have one writer at a time. Workers
submit required shared-file edits to that writer. Review each change in its PR.

Treat a shared DDEV pilot and browser captures as exclusive resources. Lighthouse
measurement also requires exclusive access to the machine's benchmark work;
pause builds and other browser workers during it. Do not run speed measurement
beside tests and call the result trustworthy. Distinct synthetic servers use
distinct ports, outputs, and browser contexts. Distinct CMS worktrees use distinct
DDEV names and databases. Never stop another worker's environment.

Workers report issue, branch, base/head SHAs, changed contracts, checks, blockers,
and the next action. The coordinator integrates evidence and opens or updates
draft PRs. Independent review may run beside unrelated implementation, but does
not consume the author's session. Respect the release-specific authorization below.

## Execution cycle

1. Read the specification, issue, repository rules, and accepted decisions.
2. Inspect GitHub and the checkout. Resume an existing branch or PR for the issue.
3. Select one eligible issue. Record the base commit and acceptance examples.
4. Implement in an isolated worktree. Run the relevant deterministic checks.
5. Give an independent reviewer the requirement text, diff, base SHA, head SHA,
   and test evidence. Do not give it the author's reasoning or another review.
6. Verify each finding in code. Fix it, reject it with evidence, or defer it to
   an explicit issue. Re-run checks affected by a fix.
7. Open or update a draft PR assigned to `parisek`. Cite requirements. Record
   exclusions, review disposition, model identity, and validation.
8. Wait for CI. Repair failures. A failed external service is a recorded blocker,
   not a successful check.
9. Review the final head. If the diff changes after review, review the changed
   surface again. Record which exact SHA the review covers.
10. For v0.1.0, merge after final independent review and green CI. For later work, leave the PR as a draft for the owner. Select another independent issue,
    or wait for a merge or a decision. Use the native stack exception below for
    an approved cohesive feature with dependent layers.

## Native GitHub planning and review

A root issue tracks delivery. Its sub-issues track release outcomes. Each release
issue has implementation sub-issues. GitHub milestones group planned tags such
as `0.1.0`. They do not set release dates. Native blocked-by links express
prerequisites. Parent-child links express scope, not execution order.

Use native stacked PRs when a single settled feature has small dependent layers
that reviewers can assess separately. Keep independent work on separate branches.
A stack stays in one repository. Cross-repository migration PRs use issue links.

Use `gh stack init`, `gh stack add`, and `gh stack submit --auto`. The last command
creates drafts by default. Keep each PR a draft until final review and CI pass. Use merge commands only within the release-specific authorization below. Assign
each PR to `parisek`, link its leaf issue, and describe its layer and prerequisites.
Do not emulate native stacks by changing PR base branches manually.

A dependent layer may start before merge only when its prerequisite contract is
settled, its lower layer passes local checks, and both belong to the same feature
stack. Keep the issue dependency unresolved until the lower layer merges. Review
each layer's own diff and test the cumulative stack. Record base and head SHAs.
After a lower-layer edit, use `gh stack rebase` and `gh stack push`, then rerun
affected checks and reviews. After merges, use `gh stack sync` and verify
the remaining diffs. Native stack support must work before this exception applies.

GitHub evaluates native stack checks against the trunk. Keep checks enabled on
every layer. A stack does not bypass independent review, CI, migration prerequisites,
or release gates. Do not stack across an unresolved conceptual decision.

For visual changes, attach synthetic before, after, and diff screenshots directly
to PR bodies with `gh pr edit --body-file ... --attach ...`. Use clear alt text,
target, viewport, capture settings, and head SHA. Inspect every image before upload.
Client captures stay local even when the target is a local DDEV site. Use
`example-site` fixtures for public evidence. Do not commit images merely to get
an image URL. If an attachment upload partly fails, inspect the existing PR and
repair it rather than creating another PR.

Accepted retry policy: at most three repair cycles for the same failing acceptance
case, then report the cause and alternatives. This is not a spending limit.
Do not invent a workaround that weakens an acceptance test.

The reviewer has a separate session and does not edit the implementation.
Use a different model when available and approved. If it is unavailable, state
that fact. A fresh session with the same model gives independent context, but
does not fulfill a requirement for a different model. Record reviews as comments,
not formal approvals. An author cannot approve its own PR.

## Durable state and continuation

GitHub issues and PRs hold public progress. Local `.test-kit/` state holds private
pilot paths, active worktree, issue/PR identifiers, SHAs, check results, review
coverage, retry count, decisions needed, and the next action. Never store tokens.
On restart, reconcile this state with GitHub. Do not create duplicate issues or
PRs. A lock prevents two invocations from selecting the same issue.

An active Codex goal can drive the current milestone. A heartbeat can resume
after CI or an owner merge. Configure the continuation only after the owner
records its scope, spending limit if any, and review provider. The machine must stay available
for local work. A prompt alone does not make DDEV or a second model available.

## Decision boundary

Owner authorization in the Codex chat on 2026-10-09: create issues and draft PRs,
repair review and CI findings, select skeletons, and use a designated local
Drupal pilot. All target access stays local. A later instruction authorizes autonomous merge and release through v0.1.0. Later milestones keep owner merge and release authority. The pilot identity and paths stay in ignored local state.

The owner accepts these choices in the Codex chat on 2026-10-09: MIT licence;
screenshot A/B, viewer, and summary for the first version;
component-specific behavior contracts stay with the components; no checks run
by default in the first screenshot milestone. Resolve later check defaults before
the content milestone. Reconcile the accepted choices with the specification and
its parent issue in TK-01. Add the licence before the first tag. Do not treat these
accepted choices as unresolved gates on restart.

Routine implementation choices: file names, internal functions, test fixtures,
error wording, and fixes within the approved contract.

Remaining owner decisions: cross-engine scope, later check defaults, snapshot
deletion policy, breaking project interfaces, review provider availability, and
an optional spending limit. Merge and release through v0.1.0 are authorized; later milestones require owner approval.

Accepted boundary: local targets only; automatic implementation, review repair,
issues and draft PRs within accepted scope; autonomous merge and release through v0.1.0 after independent review and green CI. Record the
operational goal and review provider before enabling continuous execution.

## Sources

- Specification: https://github.com/parisek/test-kit/blob/main/docs/specification.md
- Parent issue: https://github.com/portadesign/tailwind-base/issues/873
- Codex goals: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- Sub-issues: https://docs.github.com/en/rest/issues/sub-issues
- Dependencies: https://docs.github.com/en/rest/issues/issue-dependencies
- Native stacks: https://docs.github.com/en/pull-requests/reference/stacked-pull-requests
- Attachments: https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
