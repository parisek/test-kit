## Summary

<!-- What changes and why. Cite the requirement number (R6.7) when the change meets or changes one. -->

## Tier, principle and requirement

<!-- `docs/vision.md`, "How the agent decides". Fill in each line. -->

- Tier (1, 2 or 3):
- Principle (number from `docs/vision.md`):
- Requirement (R-number, or "none"):

## Checklist

- [ ] The title is a Conventional Commit (`feat(capture): ...`). The squash commit uses it.
- [ ] The pull request is a draft and assigned to `parisek`.
- [ ] The summary or the commit cites each requirement number (`R6.7`) that the change meets or changes.
- [ ] `npm test` passes. A viewer change also passes `npm run test:viewer` and `npm run check:viewer`.
- [ ] A change to behavior has a test. Pure logic has a unit test in `tests/unit/`.
- [ ] A change to the specification updates `docs/specification.md` and the linked issue in the same step.
- [ ] `CHANGELOG.md` has a line under `[Unreleased]`.
- [ ] No client name, URL, screenshot or real report in code, tests, fixtures, commits or this text. Use `example-site`.
- [ ] Nothing new runs by default (R5.1).

## Review and risk

- [ ] Release or workflow change (owner merges).
- [ ] Security path or security finding (owner decides).

## Left alone

<!-- What you rejected or did not change, and why. A diff cannot show a non-change. -->
