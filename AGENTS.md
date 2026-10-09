# AGENTS.md

Project instructions for AI coding assistants (Claude Code, Codex CLI, Cursor, Copilot, ...). Claude Code imports this file from `CLAUDE.md`. Human contributors: see `README.md` and `CONTRIBUTING.md`.

## Overview

`@parisek/test-kit` is a Node package that tests and compares a site. A project adds configuration and targets. The package holds the engine (capture, compare, checks), the report viewer and the query interface for agents.

The specification is `docs/specification.md`. Read it before any change. Requirements carry numbers (`R6.7`). Cite the number in a commit message or a pull request when a change meets or changes a requirement.

## Configuration

```yaml
PACKAGE_NAME: "@parisek/test-kit"
NODE_REQUIRES: ">=20"
TESTS_DIR: "tests"
PLAN: "docs/specification.md section 14"
```

## Development Commands

```bash
npm test                        # node --test (finds *.test.js; no dependency, no browser)
node bin/cli.js --help     # the command line
```

## Layout

| Path | Holds |
| --- | --- |
| `bin/` | The executable. It only calls `src/cli/run.js`. |
| `src/<area>/` | One area for each part of the architecture. Each folder has a README with its contract and its spec sections. |
| `frontend/` | Vue source, Tailwind tokens, and the isolated Vite build. |
| `viewer/` | The compiled viewer. Do not edit it by hand. |
| `templates/` | Files that `test-kit init` copies into a project. |
| `tests/unit/` | Pure logic. No browser, no network. |
| `tests/fixtures/` | Sample data only. |
| `docs/adr/` | Decision records. |

## Rules

- **Pure logic stays pure.** Classification, scope of rules, adapters and guards have no DOM and no file system. They run in `node --test` (R4.4).
- **Report data is untrusted.** Text goes in as text nodes. A URL attribute stays on the page origin. A value that reaches a shell must be a plain relative path. The prototype `js/safe.js` shows the guards.
- **Additive.** A new artifact or check is a new file. It does not change the core. Nothing new runs by default (G3, R5.1).
- **No client data.** This repository is public. No client name, URL or screenshot in code, tests, fixtures, commit messages, issues or pull requests (R12.4). Use `example-site`.
- **Measure before you claim.** A number in a document is measured, or it says it is an estimate.

## Language

Everything in this repository is English: code, comments, documents, commit messages, pull requests, issues. Write it in ASD-STE100 style: one idea per sentence, active voice, present tense, one word for one meaning, short sentences. Terms of the stack stay (breakpoint, Playwright, idempotent).

## PR + Review workflow

- One logical change for each pull request. A pull request is a draft, assigned to `parisek`. The owner marks it ready and merges it unless the chat grants specific merge authority. The owner authorizes autonomous merge and release through v0.1.0 on 2026-10-09. CI and independent review remain required.
- The pull request title is a Conventional Commit (`feat(capture): ...`). Pull requests are squash-merged and the title becomes the commit subject. The `pr-title` workflow checks it.
- The commit body records what was rejected or left alone. A diff cannot show a non-change.
- After you open a pull request or push to it, wait for CI. A pull request is not ready until the checks are green or you explained the failure.
- A change to the specification updates `docs/specification.md` and the issue linked from the README in the same step.

## Not decided yet

These are open in the specification, section 17. Decided: releases are git tags, there is no npm registry (section 13.2). Do not decide them in code. Ask the owner.

- The small default set of checks.
- How long content snapshots live, and who deletes them.
