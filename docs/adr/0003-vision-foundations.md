# ADR 0003: Foundations of the vision

Status: proposed. The owner approves the milestone model and the open decisions below.
Requirements: R5.1, R8.7, R13.7, R13.41, R13.42, R13.43. Tracked in #96.

The owner directed on 2026-10-16: one package, four layers, accessibility in scope, alpha maturity, milestone-level approval, and review by two independent models. Before the pull request merged, two reviewers argued against the direction. Reviewer A is Codex. Reviewer B is the advisor model of the Claude session. Neither is the owner. This record keeps what they said and what changed.

| Point | Reviewer A | Reviewer B | Result |
| --- | --- | --- | --- |
| The result model has no stable core for single-run and lint checks | Critical. An ADR must come before any scope growth | Not raised | Accepted. The vision blocks single-run work until an ADR defines one result model |
| One package for all packs couples release cadence | High. Prefers a kernel and separate pack packages | Not raised | Partly. The owner wants one package. One repository, one tag and an entry point for each pack stay. Independent pack versions wait until churn is measured (decision 10) |
| Two models agreeing is not a safety boundary | High. Bind reviews to the SHA, require cumulative tests, escalate public contracts | Independence is formal. Reviewer gets diff, spec and vision only. An empty review is a fail | Accepted. The review rule has reviewer rules and checkable items |
| The vision can change itself | Agrees | Any change to the vision is Tier 3 | Accepted |
| "Fits the vision" is not testable | Keep as judgement, not as the gate | Replace with checkable items | Accepted |
| Milestone branch is an invention | Partly. A label removes drift but needs a cumulative gate on `main` | Squash of a milestone loses per-change commit bodies. Prefer a label and merges to `main` | Open for the owner (decision 8). Both lean to merging into `main` |
| Alpha churn conflicts with migration | Agrees. Settle the seam first | Freeze the seam or finish churn first | Open for the owner (decision 9) |
| A pack has no lifecycle owner | Agrees | Name an owner. Retire sets with no consumer | Accepted (layer rules 8) |
| R13.42 contradiction has no tracker | Agrees | Create an issue and cite it | Done. Issue #96 |
| Skills should be thin | Put invariants in CI, evidence in a template, orchestration in a script | Not raised | Accepted for the skill design. No skill exists yet |
| No success thresholds, rollback or deprecation policy | Medium | Not raised | Open. Needs a section in a later change |

What neither reviewer verified: the pull request diff, the CI configuration, the skeleton projects, and most specification line numbers.

Left alone: a kernel with separate pack packages. It conflicts with the owner's choice of one universal package.
