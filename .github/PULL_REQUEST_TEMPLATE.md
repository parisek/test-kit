## Summary

<!-- What changes and why. Cite the requirement number (R6.7) when the change meets or changes one. -->

## Tier, principle and requirement

<!-- docs/process.md, section 3, and docs/vision.md, "How the agent decides". Fill in each line. -->

- Tier (1, 2 or 3):
- Principle (number from `docs/vision.md`):
- Requirement (R-number; if none applies, write "none" and one reason):

## Tests

<!-- Which test proves which acceptance example. `npm test` output; for a viewer change also `npm run test:viewer` and `npm run check:viewer`. -->

## Docs reviewed

<!-- The docs this change touches (README, docs/specification.md and the linked issue, CHANGELOG [Unreleased]), or "No doc impact". -->

## Package checklist

- [ ] The pull request is a draft and assigned to `parisek`.
- [ ] A change to behavior has a test. Pure logic has a unit test in `tests/unit/`.
- [ ] A change to the specification updates `docs/specification.md` and the linked issue in the same step.
- [ ] `CHANGELOG.md` has a line under `[Unreleased]`.
- [ ] No client name, URL, screenshot or real report in code, tests, fixtures, commits or this text. Use `example-site`.
- [ ] Nothing new runs by default (R5.1).

## Left alone

<!-- What you rejected or did not change, and why. A diff cannot show a non-change. -->

## Review

- [ ] The title is a Conventional Commit (`feat(capture): ...`). The squash commit uses it.
- [ ] CI green on the head SHA.
- [ ] Codex record `<!-- agent:review -->` on the head SHA.
- [ ] Claude record `<!-- agent:review -->` on the head SHA.
- [ ] Release, workflow change, security path or security finding: the owner decides.
