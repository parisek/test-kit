# Development loop proposal

Status: draft for remaining owner decisions. This file does not change the specification.
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
An issue is eligible only when its decisions are resolved and dependencies are
merged. A draft PR does not satisfy a dependency.

Suggested states: proposed, ready, active, review, awaiting-owner, blocked, done.
Use these as an agreed convention before adding labels or editing issues.
Keep one active implementation issue at first. Keep a small queue of independent
issues when the owner has not merged a dependency.

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
10. Leave the PR as a draft for the owner. Select another independent issue,
    or wait for a merge or a decision. Never start a dependent issue early.

Default proposal: at most three repair cycles for the same failing acceptance
case, then report the cause and alternatives. This is a proposal, not an
approved budget. Do not invent a workaround that weakens an acceptance test.

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
chooses its scope, budget, and review provider. The machine must stay available
for local work. A prompt alone does not make DDEV or a second model available.

## Decision boundary

Owner authorization in the Codex chat on 2026-10-09: create issues and draft PRs,
repair review and CI findings, select skeletons, and use a designated local
Drupal pilot. All target access stays local. The owner keeps merge and release
authority. The pilot identity and paths stay in ignored local state.

Proposals: MIT licence; screenshot A/B, viewer, and summary for the first version;
component-specific behavior contracts stay with the components; no checks run
by default in the first screenshot milestone. Resolve later check defaults before
that milestone. Do not add a licence or change those specification decisions as
part of this infrastructure PR.

Routine implementation choices: file names, internal functions, test fixtures,
error wording, and fixes within the approved contract.

Owner decisions: licence, first milestone scope, new defaults, behavior contract
ownership, engine scope, snapshot deletion policy, production access, breaking
project interfaces, review provider and budget, merge and release authority.

Proposed default: local targets only; automatic implementation, review repair,
issues and draft PRs within accepted scope; owner merge and release. Do not
publish or enable the loop until these choices are recorded.

## Sources

- Specification: https://github.com/parisek/test-kit/blob/main/docs/specification.md
- Parent issue: https://github.com/portadesign/tailwind-base/issues/873
- Codex goals: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
