# ADR 0005: Static data first, viewer without a server

Status: proposed. The owner asked for this direction in chat on 2026-10-20. The owner has not yet accepted this text. Acceptance is a Tier 3 decision (it edits the vision and a numbered requirement).
Requirements: R10.1, R10.10, R10.11, R5.1, R8.9. Principles: 2, 4, 5, 6. Tracked in a new issue (see the pull request).

## Context

The owner wants to open results from a link in the styleguide. No process runs. Several projects stand side by side. The only step is to regenerate the data.

What the code does today (read on 2026-10-20):

- `report --export DIR` and `history --export DIR` write static directories (`src/export/report.js`, `src/export/history.js`). They start no server. R10.11 says the viewer loads under any URL prefix.
- Both commands refuse an existing output directory. They stage in a temporary directory and rename it.
- Each report export copies the whole viewer (`index.html`, `app.js`, `style.css`) next to its data.
- `history --export` links to one viewer copy for each report.
- The viewer has a data-source switch inside the page (R10.10).
- R10.1 says the local server serves the viewer. The vision never says how a report is read.
- `docs/` of the pilot project teaches `test-kit report` (a loopback server) as the main path.

The gap: there is no stable place to read from. A new export needs a new directory name. Nothing lists the runs of one project in a form that the viewer reads.

## Decision (proposed)

1. **The package writes data. The viewer reads data.** The contract between them is a directory: report JSON, evidence files and an index.
2. **The viewer is a static application.** It needs no process. It loads under any URL prefix (R10.11).
3. **The server is a convenience.** `report` and `history` without `--export` stay. Workflow documents name the static path first.
4. **A stable publish directory.** A project sets one directory (for example `.test-kit/site`). A new command mode refreshes it in place. The refresh stages the new content and replaces the old one in one rename. A failed refresh leaves the old content.
5. **An index file.** The directory holds `index.json`. It lists runs and reports with an id, a kind, a time, the `settingsHash` and a relative path. The viewer reads it. Order and content are generated, never hand-edited.
6. **One viewer copy for each directory.** Reports in the directory share it. A report directory holds data and evidence only.
7. **Several projects.** Each project writes its own directory. The viewer is the same code in each. The package adds no registry of projects.

## Sharing rules (proposed)

Principle 4 stays: no account, no upload, no hosted service. The package never publishes. The project decides what its web server does.

- **Default is local.** The publish directory is under the project, listed in `.gitignore`. The package adds no setting that makes it public.
- **Sharing is an explicit project act.** The project exposes the directory. The package documents the risk. It does not perform the act.
- **Evidence is untrusted and sensitive.** Screenshots and HTML can hold personal or client data. Export keeps generated safe names and non-executable types (R10.11).
- **The package states the exposure.** A refresh prints one line: the absolute directory and "contains captured pages". This is a message, not a gate (principle 3).
- **The public repository holds no client data** (R12.4). Examples use `example-site`.
- **Open for the owner:** a project that shares must also choose retention and who deletes (spec section 17). This ADR does not decide it.

## Options rejected

- **Keep the server as the main path.** A process per project, one port each, no link from a styleguide. Fails the stated need.
- **A hosted viewer.** Breaks principle 4.
- **Query strings for state.** Hosting may drop them (R10.10).
- **Overwrite by default.** `--export` keeps its refusal. The in-place refresh is a separate, named mode, so a typing error cannot delete an export.

## Not verified

- Whether the viewer can load an index and many reports from one copy without code changes. The data-source switch exists (R10.10). Nothing reads it for a list yet.
- Whether browsers load `report.json` from `file://`. Assume they do not. The static host is a web server, not the file system.
- Size of the publish directory after many runs. Not measured.

## Work packages

Each package is one pull request. Each ends in tests that run in `node --test` or the frontend suite.

1. **Spec and vision.** Edit R10.1, R10.11. Add one requirement for the in-place refresh and one for `index.json`. Add the sentence from "Decision" to the vision. Tier 3.
2. **Index writer.** Pure function from the scanned history to `index.json`. Unit tests with fixtures. Tier 2.
3. **In-place refresh.** CLI mode, staged write, one rename, old content kept on failure. Tier 2.
4. **Viewer reads the index.** One viewer copy for the directory, the list and the report load from it. Frontend tests and `check:viewer`. Tier 2.
5. **Documents.** README, `docs/rc-trial.md`, migration guide. Tier 1.
6. **Pilot in `tailwind-base`** (authorized by the owner): doctrine text, a styleguide link, the web server rule for the directory. Ends in an audit by the owner.

## Autonomy and approval

- The agent opens packages 2 to 5 as draft pull requests. Each follows the review and merge rule of `docs/vision.md`: two independent reviews of the same SHA, green CI, not Tier 3.
- Package 1 and the publish rule of the pilot are Tier 3. They wait for the owner.
- The agent does not tag a stable release.
- Test in `tailwind-base` after package 4 and before any release candidate tag.
