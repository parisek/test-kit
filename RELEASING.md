# Releasing `@parisek/test-kit`

`test-kit` is not on the npm registry. A project installs it from a git tag of this repository (specification section 13.2). A release is a tag.

`package.json` stays `private: true`. A `npm publish` by mistake fails.

## Install in a project

```bash
ddev npm install -D github:parisek/test-kit#v0.2.0           # before 1.0: an exact tag
ddev npm install -D "github:parisek/test-kit#semver:^1"      # from 1.0: a range
```

The lockfile records the commit, so a project does not change when someone moves a tag. Nobody moves a tag.

## Prerequisites

- `main` is green (`npm test`, the CI matrix).
- `CHANGELOG.md` lists the changes under `[Unreleased]`.
- The licence is chosen. A public repository without one means all rights reserved.

## Procedure

1. **Pick the version** (semver). Before 1.0, a minor version may break.

   | Bump | When |
   | --- | --- |
   | MAJOR | A breaking change to the config, the report format or a command |
   | MINOR | A new command, artifact, check or option |
   | PATCH | A fix or a documentation change |

2. **Open a release pull request.** Set `version` in `package.json`. Rename `[Unreleased]` in `CHANGELOG.md` to `[X.Y.Z] - YYYY-MM-DD` and add a new empty `[Unreleased]` above it. Title: `chore(release): vX.Y.Z`.
3. **The owner merges it.**
4. **Tag `main`:** `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag must equal `version` in `package.json`.
5. **The `release` workflow runs.** It checks that the tag equals `version`, runs the tests and creates a GitHub Release from the `CHANGELOG.md` section. It fails when the section is missing.

## Rules

- A tag never moves and never gets deleted. A mistake is fixed with the next tag.
- A tag protection rule on `v*` in the repository settings enforces this. It is a setting of the owner and is not set yet.
- The package has no build step. The `files` list in `package.json` decides what a project receives. A build step needs a `prepare` script or a committed build.

## Not verified

- `git` inside the DDEV container. `npm install` from GitHub needs it.
- The `release` workflow. The first real tag is its first run.
- Automatic version bumps by Renovate or Dependabot for a git tag. Bump by hand for now.
