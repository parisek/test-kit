# Releasing `@parisek/test-kit`

Status: **not released**. `package.json` is `private: true` so nothing can be published by mistake.

The release channel is open (specification section 17): the npm scope `@parisek`, or a git dependency from a tag. Decide it before the first release. Then write the procedure here.

Until then:

- Version numbers follow semver. `0.x` may break between minor versions.
- `CHANGELOG.md` keeps an `[Unreleased]` section.
- A tool that moves in from `tailwind-base` (the moves after plan step 7) needs a release before the skeleton repository can pin it.
