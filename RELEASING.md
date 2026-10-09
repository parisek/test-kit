# Release procedure

Requirements: R13.24–R13.31.
The package ships through immutable `vMAJOR.MINOR.PATCH` tags on `main`.
It stays `private: true`. Do not publish it to the npm registry.
Before 1.0, projects pin an exact tag. The lockfile records its commit.

## Release gates

- Independent review covers the final implementation head.
- CI and relevant local integration checks pass.
- Capture, comparison, viewer, and summary work on synthetic local evidence.
- Package contents and installation in DDEV are verified.
- The package version and lockfile agree.
- The matching changelog section has nonempty release notes.
- The MIT licence ships in the package.

## Publish a tag

1. Open a release PR. Update package version, lockfile, and changelog.
2. Review the final head. Wait for green CI. Merge to `main`.
3. Fetch `origin/main`. Confirm the release commit is on that branch.
4. Create the new tag on that commit and push it. Never replace an existing tag.
5. Wait for the release workflow. Verify its GitHub Release and notes.
6. Install the exact tag in the local pilot and repeat the smoke test.

The owner authorizes autonomous merge and release through v0.1.0 on 2026-10-09.
Later releases require owner approval. CI and independent review remain required.
A failed release check requires repair; it does not authorize moving the tag.
A correction after tagging uses a new patch version.

## Workflow contract

The tag workflow rejects prerelease or malformed tags. It checks the exact
package version, `private: true`, the MIT licence, and main ancestry. It installs
locked dependencies, runs tests, and extracts the matching changelog section.
It creates the GitHub Release only after these checks pass.

## Install the release

```sh
ddev npm install -D github:parisek/test-kit#v0.1.0
```

The container needs git and Node 20 or later. Chromium capture uses the host
browser. The package has no build step. `files` in `package.json` selects the
installed files. Keep pilot paths and capture evidence outside the repository.
