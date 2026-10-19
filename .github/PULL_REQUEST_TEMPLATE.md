## Summary

<!-- What changes and why. Cite the requirement number (R6.7) when the change meets or changes one. -->

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

- [ ] The change touches a release, security or workflow path, or it is a Tier 3 item (`docs/vision.md`). The owner decides. Do not merge it without the owner.
- [ ] A review record for the head SHA is in a comment, when the process in `docs/process-skills.md` applies.

## Left alone

<!-- What you rejected or did not change, and why. A diff cannot show a non-change. -->
