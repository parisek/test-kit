# Upgrade from v0.5.0 to `main`

Status: measured on 2026-10-19. It serves issue #105 and R13.9.
`main` is commit 245611d. Its `package.json` still says version `0.5.0` (before this candidate). At that time no tag newer than `v0.5.0` existed (`git tag -l`: v0.1.0, v0.2.0, v0.2.1, v0.3.0, v0.4.0, v0.5.0). This is history. The tags `v1.0.0-rc.1` and `v1.0.0-rc.2` exist now. A project pins the newest candidate tag (see [rc-trial.md](rc-trial.md)).

## Result

Nothing in the project-facing interface breaks. Outside `src/packs/` and the new `packs` key in `src/config/`, `src`, `bin`, `templates` and `viewer` do not change. The project-facing changes are additive and non-breaking. Other files changed too: `package.json` (exports, optional `axe-core` peer, `axe-core` devDependency), `package-lock.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `AGENTS.md`, `RELEASING.md`, `CHANGELOG.md` and the documents under `docs/`, plus tests and fixtures.

## What changed

Measured with `git diff v0.5.0 origin/main` (12 commits, `git log --oneline v0.5.0..origin/main`).

| Area | Change | Evidence |
| --- | --- | --- |
| `src/` outside `src/packs/` | `src/config/` accepts the optional `packs` key (R13.44). Otherwise none | `git diff --name-only v0.5.0 origin/main -- src bin templates frontend viewer scripts` lists only `src/packs/` files (measured at 245611d, before the `packs` key). |
| `bin/`, `templates/`, `viewer/` | None | Same command. |
| CLI | None | `node bin/cli.js --help` prints the same bytes on both revisions. Both printed `0.5.0` for `--version` when measured. The candidate sets `1.0.0`, so a build of it prints `1.0.0`. |
| Configuration | None | `normalizeConfig` accepts the same keys, plus the new optional `packs` key (R13.44). The shipped template gives the same result on both. A config without `packs` behaves as before. |
| Root export (`.`) | None | The list of exported names is the same on both. |
| `package.json` `exports` | Six entries added | `./packs`, `./packs/a11y`, `./packs/a11y/runner`, `./packs/swiper`, `./packs/lint`, `./packs/lint/runner`. The three v0.5.0 entries stay. |
| `package.json` peer dependencies | `axe-core` added as optional | `^4.10.0`, `peerDependenciesMeta.optional: true`. A project that does not use the axe runner needs nothing. |
| `package.json` `files` | None | |
| Release workflow | Narrower | `.github/workflows/release.yml` now runs on stable tags `vX.Y.Z` and on rc tags `vX.Y.Z-rc.N` (R13.45) only. A dev tag `vX.Y.Z-dev.N` starts no run (R13.26). |
| CI | One step added | `node tests/integration/check-a11y-runner.mjs`. |
| Documentation | Added | `docs/vision.md`, `docs/adr/0004-result-model.md`, `docs/process-skills.md`, pack READMEs. The specification changed (R13.9, R13.25, R13.26, R13.42). |

The new packs (`a11y`, `swiper`, `lint`) are opt-in (G3, R5.1). The optional `packs` configuration key selects them (R13.44). No command runs them yet. A project that does not import them sees no change.

## Steps

1. Pin the new version with a candidate tag (R13.27): `npm install -D github:parisek/test-kit#v1.0.0-rc.4`. Replace the tag with the newest candidate. At the time of the 0.5.0 measurement only a commit form was possible. Not verified: this exact install from a commit in a project.

   One consumer project saw this once, with npm 11.19 and 11.20. `package-lock.json` held a `git+ssh://git@github.com/...` URL for this dependency. The spec was `git+https`. This is npm behaviour, not a choice of this package. A project whose rules require HTTPS can set the `resolved` scheme to `git+https://github.com/parisek/test-kit.git#<commit>` by hand. Then install with `npm ci`. Verified once on one consumer project on 2026-10-19: `GIT_SSH_COMMAND=false npm ci` in a clean cache installs and leaves the lockfile unchanged, and `npm ls` shows the https URL. `npm ci`, `npm ls` and `npx test-kit --version` leave the scheme alone. `npm install` and `npm install --package-lock-only` write `git+ssh://` back (measured on a copy). One project script that runs npm commands also rewrote it, and the cause is not found. Run `git diff package-lock.json` before every commit.
2. Keep `test-kit.config.json` as it is. No key changes. Not verified in a project.
3. Keep your project aliases as they are. No command or flag changes. Not verified in a project.
4. Optional, only when you use `@parisek/test-kit/packs/a11y/runner`: `npm install -D axe-core@^4.10.0`. Not verified in a project.
5. Run the checks in the list below.

## What breaks

- Shipped: nothing.
- Planned, not in the code: `report.json` goes to `schemaVersion` 3. `pair` becomes optional. A reader that supports only version 2 rejects a version 3 file with a message about `schemaVersion` (R9.1, `CHANGELOG.md`, Unreleased, Migration). The code still writes version 2 on `main`. No project change is needed today.
- Stored `known_diffs` records bind a comparator policy hash. This change set does not alter the comparator, so existing records stay valid. Not verified on a real project.

## Verification

Run by the author of this document, in this repository, on 2026-10-19:

- `npm test` on `main`: 267 tests, 267 pass, 0 fail. The vision (2026-10-18) states 161. The count rose as the pack tests merged.
- `node tests/integration/check-consumer-install.mjs`: the packed package installs, reinstalls from its lockfile, and passes the CLI, import, query and viewer checks in three synthetic layouts (parent, WordPress, Drupal), using the offline npm cache. The script states that `init`, exact git release adoption and DDEV are not verified.
- Export resolution: every entry in `exports` loads with `import()` on `main`.

Not run, because no project checkout is in scope:

| Command | Expected result | State |
| --- | --- | --- |
| `npx test-kit --version` | Prints the installed version, `0.5.0` for `main` at 245611d (measured). `1.0.0` for the release candidate. Exit 0. | Not run in a project |
| `npx test-kit capture --side local --label before` | One JSON line with `id`, `state`, `manifestPath`. Exit 0 when `state` is `complete`. | Not run in a project |
| `npx test-kit diff <run-a> <run-b> --output tests/visual/report` | One JSON line with `reportPath`. Exit 0. | Not run in a project |
| `npx test-kit summary tests/visual/report/report.json --filter unexplained` | One JSON line. | Not run in a project |
