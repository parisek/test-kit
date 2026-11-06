# ADR 0009: Reference keep-existing and bounded transient retries

Status: Proposed, not decided. The owner decides (Tier 3: it adds capture options and a stored key, and it touches the honesty of evidence). No code or specification change comes with this record.
Requirements: R3.6, R3.7, R3.9, R5.1, R5.6, R8.7, R8.9, R8.16, R12.1, R12.4, R13.13. Principles 1, 5 and 8 of the vision. Tracked in #315 (slice 6 of #49, parent #45). Follows ADR 0007, decision 6.

## Context

#49 lists "keep-existing references, FORCE, and bounded transient retries" among the legacy surfaces to preserve. ADR 0007, decision 6, fixes one point: retries and keep-existing decisions stay out of `recipe`. They change which run exists, not how a capture is made. It leaves open whether to record them elsewhere. #315 asks for a short proposal before code.

This record does not read the legacy `tailwind-base` files. They are not on this machine (owner decision, 2026-11-06). The facts about the legacy behavior come from #49 (the names of the surfaces), #50 (migration guards) and `src/compat/README.md` (the planner that exists). Where the legacy value matters, a question below asks the owner.

What the package does today (read on `main` at `1d7145e`):

- A run is a directory with `run.json` and the stored files. `capture` writes it and never edits another run. Nothing deletes a run automatically (R12.1, section 17 item 4).
- `captures[]` holds one entry per selected cell. An entry has `state` (`captured` or `failed`), the file `path`, `recipe`, `settleHash`, `scopeHash`, optional `dropped` and optional `warnings` (R5.11). `warnings` enters no hash.
- A failed capture removes its partial file and returns a `failed` entry with an `error`. The run `state` is `complete` only when every selected cell is `captured`. The command exits 1 otherwise. A failed or missing cell never reads as `match` (R8.7).
- After an edge stop (R3.6) every later cell fails with `RUN_STOPPED` and sends no request.
- `comparisonState` compares run hashes, tool versions and, for each capture, the recipe (R8.16).
- `src/compat/harvest-plan.js` plans `keep` or `capture` for each legacy reference file from a list of existing filenames, and `legacyHarvestForce` reads the text of the FORCE variable. It reads no file system, starts no browser and retries nothing. Its README says: "A kept reference is not a new measurement."
- #50 states these guards: "A browser abort must mark the run incomplete and produce a nonzero exit status." Reference planning stays separate from validation of URLs and recipes. An all-kept plan must not hide invalid configuration.

Two facts shape the proposal.

1. Keep-existing is a stale-evidence feature. It makes a new run hold a measurement that an earlier run took. The package can do that honestly only when the reader sees it and when the old capture is provably the capture the new run would have made.
2. A retry is a second try of one cell. If the record hides it, a flaky page reads like a stable one. If the retry is unbounded or covers the wrong errors, it hides a real failure or hits a remote origin again after it said stop.

## Constraints

- Nothing new runs by default (R5.1). Both features need an explicit option.
- Runs are immutable. A command never edits an earlier run.
- `run.json` is frozen for 1.x (`docs/seam.md`). A new optional key is an addition. `schemaVersion` stays 2.
- The run `settingsHash`, `settleHash`, `scopeHash` and `recipe` must not change for a run that uses neither feature (ADR 0007). Neither feature may enter them.
- A failed, missing or incompatible cell never becomes `match` (R8.7, principle 1).
- Stored data is untrusted. A reader validates every new key. A path that the package copies must be a plain relative path (AGENTS.md, rules).
- Pure logic stays pure (R4.4). Eligibility and error classification have no DOM and no file system. A test must fail without them.
- The repository is public. Examples use `example-site` (R12.4).

## Topic 1: keep-existing

Meaning. With keep-existing on, `capture` does not open the page for a cell when an earlier run holds a capture that the new capture would repeat. The new run still holds an entry for the cell. The question is what that entry is.

### Eligibility (common to all options)

An earlier capture may stand for a cell only when all of these hold. Each one is a test on stored data. Any miss means the cell is captured fresh.

1. Same side id, and the stored side declaration equals the current one (origin, `remote`, `userAgent`, `challenge`, `allowOrigins`, `thirdParty`). Two of these keys are outside the settings hash by design (R3.4, R3.5), so the hash alone does not prove them.
2. Same run `settingsHash` and the same `tools` list (browser version included, R8.9).
3. Same target declaration: `path` and every key that changes what the page shows. The settings hash excludes target selectors and paths. So the stored `settings.targets[id]` must equal the current one.
4. The source entry is `captured`, and every artifact that the new run selects is `captured` in it with equal provenance.
5. The stored `recipe` equals the recipe that the new capture would write now, `version` included (R5.6, R8.16). A raise of the engine version makes every old capture ineligible, which is the intended effect.
6. The source run is `complete`. (Open question 4 asks whether a `partial` run may also supply a captured cell.)
7. The side is `remote: true`. A local side must refuse the option. Local code changes between runs, and a kept local capture would read as `match` against changed code. (Open question 3.)

### Option K1: point to the earlier capture

The new entry stores `kept: { runId }` and no file. Readers follow the pointer into the older run.

- For: no copy, no extra disk, smallest run.
- Against: the run stops being self-contained. Export and publish (R10.11) keep report data and artifact references inside one directory, so a pointer breaks them. A person who removes the older run leaves a dangling pointer, and R12.1 says a person may remove runs. `diff` and every reader must resolve across runs and handle a missing target. That is new reader logic in every consumer.

### Option K2: copy into the new run, with provenance

The new entry is a normal `captured` entry. The package copies the PNG and the other selected artifact files from the source run to the same relative paths in the new run. The entry also carries `kept: { runId, at }`. `at` is the `at` of the source run, so the real age of the measurement stays visible. `recipe`, `settleHash` and `scopeHash` are copied unchanged.

- For: the run stays self-contained and immutable, and every reader works unchanged. A kept entry compares exactly like a fresh one, because eligibility proves an equal recipe, equal run hash and equal tools. No new state exists (R8.7). The provenance is a plain stored fact.
- Against: it uses disk for every kept file (not measured; one PNG for each kept cell and viewport). A reader that ignores `kept` shows an old capture as new. The package must therefore show `kept` itself (see "Recording"). The copy needs a safe read of a path that comes from a stored manifest.

### Option K3: no keep in `capture`. Reuse the old run as run A of `diff`

No new key and no copy. The user passes the older reference run as `diff` input and captures only the missing cells into a second run.

- For: no change to `run.json` and no stale entry in a new run. This is closest to "runs are immutable".
- Against: `diff` compares two runs. A reference that is half old and half new cannot be one run, so the missing cells read `missing` and the verdict is `incomplete` (R4.5). It does not preserve the legacy behavior (a full set of references after one command), so the thin alias cannot call it.

### Recommendation: K2

K2 is the only option that keeps a run self-contained and the legacy outcome (one command, full set). K1 trades a copy for a fragile pointer. K3 does not meet the goal of #315.

Rules for K2:

1. The option is the flag `capture --keep-existing`. It is off by default (R5.1). It needs a `remote: true` side.
2. The package scans the runs of the store, newest first, and takes the first eligible entry for each cell. It reads each manifest with the existing validated reader (`readRun`).
3. It copies a file only from a validated plain relative path inside the source run directory. It does not follow a symbolic link. A copy that fails makes the cell fresh, not failed. A fresh capture that follows fails like any capture.
4. A kept entry does not enter any hash. `kept` is outside `recipe`, `settleHash`, `scopeHash` and `settingsHash`.
5. `capture` prints one line on stderr: `Kept N of M captures from earlier runs.` It never names a page or a URL. The one JSON line on stdout adds `kept` (a count) only above zero.
6. A project can validate its URLs and recipes before keep runs. An all-kept plan does not skip that check (#50). Keep decisions happen after configuration validation and before the browser context for the cell.

## Topic 2: bounded transient retries

Meaning. When one cell fails for a reason that a second try can fix, `capture` tries that cell again, up to a fixed bound, then continues. A retry never changes a recipe or a hash.

### What counts as transient

The rule is a closed allowlist. An error that is not on it is never retried (fail closed). The decision uses the error object and the flags that `captureOne` already tracks, not the message of the final `failed` entry.

Retried:

- a Playwright `TimeoutError` in navigation or in a wait,
- the whole-capture deadline (`Capture deadline exceeded`),
- these Chromium network errors: `ERR_CONNECTION_RESET`, `ERR_CONNECTION_CLOSED`, `ERR_CONNECTION_TIMED_OUT`, `ERR_TIMED_OUT`, `ERR_EMPTY_RESPONSE`, `ERR_NETWORK_CHANGED`. This list is a candidate. The slice must check the names against the Chromium build that the package pins, and it must test each one.

Never retried:

- `REMOTE_EDGE_STOP` and `RUN_STOPPED` (R3.6). A retry after an edge stop would send a request the run promised not to send. A challenge or rate limit is also not a transient fault.
- `LOCAL_NAVIGATION_REQUIRED` and any other policy block (R3.7, R3.9), including a failed request to an allowed origin and a certificate error. A policy block is deterministic.
- A page response with status 4xx. This includes 403 and 429, which already stop the remote run. A 4xx page is a result, not a fault.
- Any error when `edge`, `blocked` or `unexpectedNavigation` is set, whatever its message says.
- `PIN_NO_MATCH`, an invalid PNG, a bound error, a configuration error and `PLAYWRIGHT_VERSION_UNSUPPORTED`.
- A failed `content`, `behavior` or pack artifact inside an entry whose screenshot was captured. Those states have their own meaning and are not retried.
- A browser or page crash, and a refused connection (`ERR_CONNECTION_REFUSED`) or a DNS failure (`ERR_NAME_NOT_RESOLVED`). A crash must mark the run incomplete and exit nonzero (#50). A refused connection or a DNS failure usually means a stopped server or a wrong origin, which a person must fix. (Open question 6 asks about the refused connection.)
- A 5xx page response. Today it is stored as a result with a status code (the `status` artifact shows it). The proposal does not change that. (Open question 7.)

### Option T1: no retry in the package

The thin alias or the project wraps `capture` in its own loop, per run.

- For: no new code, no new risk of hidden flakiness.
- Against: a loop around `capture` repeats the whole run, not one cell, and it creates a new run for each try. It cannot classify an error because it sees only the exit code. It also repeats requests to a remote origin that has stopped. This does not preserve the legacy per-capture retry.

### Option T2: a per-cell retry with an allowlist, opt-in by flag

`capture --retries N`, with N from 0 to 2. Default 0, so a run without the flag is unchanged (R5.1). Each cell has at most N + 1 attempts.

- For: it retries only the failed cell. The classifier is a pure function with a test for each error class. The flag is outside the config and the hash, so it cannot change comparability.
- Against: a retry can hide a flaky page. The worst case grows: a cell costs up to (N + 1) × `screenshot.timeoutMs` plus the backoff. On a remote side every retry is one more request to the origin.

### Option T3: a per-cell retry set in the config

A key such as `screenshot.retries` or `sides.<id>.retries`.

- For: a project declares the policy once. A side can differ from another side.
- Against: `screenshot` sits inside the settings hash, so a retry count there would make two runs incompatible for no pixel reason. A new side key needs a rule that keeps it out of `captureSettings`, like `userAgent`. It adds a config surface and a schema for a value that a command flag can carry.

### Max attempts and backoff

Options for max attempts: 2 (one retry), 3 (two retries), or a larger configured bound. Recommended: the flag accepts 0, 1 or 2 retries. A bound of 2 retries limits the load on a remote origin and the worst case run time. The legacy value is unknown here (open question 5).

Options for backoff: none, a fixed wait, or exponential with jitter. Recommended: a fixed wait of 1000 ms × the attempt number (1 s, then 2 s), no jitter. A capture is sequential, so there is no herd to spread. A fixed wait is deterministic and the test injects the sleep function, so no test waits in real time. The wait is not stored.

Each attempt gets a fresh browser context (as every `captureOne` call does today). A failed attempt has already removed its partial file. The retry of a cell stops at the first success, the first never-retried error, or the last attempt. After an edge stop no retry runs, and later cells follow R3.6.

### Recording a retry

ADR 0007 keeps retries out of `recipe`. The record sits beside the entry, outside every hash.

- R-A: a warning code `CAPTURE_RETRIED` in the existing `warnings` list (R5.11), with `count` = the retries used. Cost: the reader, `compareRuns`, `summary` (`captureWarnings`) and the viewer already show `warnings`, so the retry becomes visible with no viewer work. The class of the error is not stored.
- R-B: a new entry key `attempts` with one `{ phase, code }` item for each failed attempt. Cost: more detail, but a new reader, a new summary key and new viewer work, which follows `DESIGN.md`. That work may become a design decision.
- R-C: no record. The final entry looks like a first-try capture. This breaks principle 1 for a flaky page and is not an option to ship.

Recommended: R-A. A failed final entry (all attempts used) says in its `error.message` how many attempts it made. The exact wording is left to the slice (Tier 1). R-B stays possible later as an addition.

The run is `complete` when every cell ends `captured`, retried or not. Exit status is 0 then. A cell that fails after its last attempt is `failed`, the run state is `partial` and the exit status is 1, as today.

## Topic 3: FORCE

Legacy FORCE re-captures references that exist (`legacyHarvestForce` reads `1`, `true` and `yes`). In the package, keep-existing is opt-in, so "do not keep" is the absence of the option. FORCE has little left to override.

### Option F1: no FORCE in the package. The alias maps it

The alias reads FORCE (with `legacyHarvestForce`) and passes `--keep-existing` only when FORCE is off. The core has no FORCE.

- For: the least surface. The core keeps one switch. The legacy variable lives in the compat layer, where it belongs (R4.3).
- Against: a script that always passes `--keep-existing` has no per-run override.

### Option F2: a `--force` flag, valid only with `--keep-existing`

`--force` makes every selected cell fresh. `--force` without `--keep-existing` fails the command, so it never becomes a silent no-op.

- For: one command line states both intents. The alias passes both through.
- Against: two flags for one effect. The same result comes from omitting `--keep-existing`.

### Option F3: a per-target force list

`--force ID,ID` refreshes those targets and keeps the others.

- For: it matches the real need "refresh this one reference, keep the rest".
- Against: it adds a selection syntax that overlaps `--target` (R4.5), and it needs rules for an unknown ID. With F1, a person reaches the same end by two commands: one fresh run of the targets to refresh, and one kept run for the rest, but the two results are two runs.

### Recommendation: F1

F1 keeps the core small. If the owner wants one-command refresh of a subset, F3 is the follow-up, and it needs its own record. FORCE never touches a hash and never bypasses eligibility: a forced capture is a normal fresh capture.

## Comparability

A kept capture compares like a fresh one:

- Eligibility 2 to 5 prove an equal `settingsHash`, equal tools, an equal target declaration and an equal `recipe` (R8.16). So `comparisonState` needs no change and no new state exists.
- A kept entry whose recipe or tools differ from the new capture is never produced. The cell is captured fresh instead.
- The comparison of a kept reference with a fresh capture of the other side follows R8.9 as before.
- The age of a kept capture is not a compatibility fact. The reader sees it through `kept.at` and the warning, not through the verdict.

A retried capture has the same recipe and hashes as a first-try capture. The comparison does not read the warning (R5.11).

## Recording summary

| Fact | Where | In a hash | Visible |
| --- | --- | --- | --- |
| Capture was kept | `captures[].kept: { runId, at }` and the warning `REFERENCE_KEPT` (count 1) | no | `warnings` pipeline (R5.11), stderr line, stdout `kept` |
| Capture was retried | warning `CAPTURE_RETRIED` (count = retries used) | no | `warnings` pipeline |
| Retry policy (N) | not stored | no | none. It is a command flag, like `--packs` (R13.51) |

The viewer and `summary` show `warnings` today. A new warning code needs no new viewer element. Any new viewer text or element would follow `PRODUCT.md`, `DESIGN.md` and `docs/viewer-workflow.md`, and a conflict becomes a design decision at the issue stage (`docs/vision.md`, "Design authority").

## Proposed requirement text

This record does not change the specification. If the owner accepts it, the first slice adds this text. Numbers are proposals.

- R5.13 `capture` takes the flag `--keep-existing`. Without it nothing changes (R5.1). The flag needs a side with `remote: true`, else the command fails before any run directory or browser exists. With the flag, `capture` must take a cell from an earlier run of the store instead of capturing it, when all of these hold: the earlier run has the state `complete`, the same side id and an equal stored side declaration, the same `settingsHash` and tools, an equal stored declaration of the target, a `captured` entry with every selected artifact `captured`, and a `recipe` equal to the recipe that the new capture would write. The newest eligible run wins. The package copies the stored files to the same relative paths in the new run, and the new entry keeps `recipe`, `settleHash` and `scopeHash` unchanged and adds `kept: { runId, at }`, with `at` the time of the source run. It copies only from a plain relative path inside the source run directory, and it must not follow a symbolic link. A cell with no eligible entry, or whose copy fails, is captured fresh. The entry also gets the warning `REFERENCE_KEPT` with `count` 1 (R5.11). `kept` and the warning enter no hash, not `recipe`, `settleHash`, `scopeHash` or `settingsHash`. A reader accepts `kept` only as an object with exactly the keys `runId` (a valid run id) and `at` (an ISO time), else it ignores the key as a whole. `capture` prints `Kept N of M captures from earlier runs.` on stderr and adds `kept` to the JSON line on stdout only above zero. A run with no `--keep-existing` stores the same bytes as before. The command offers no FORCE: a person captures fresh by omitting the flag.
- R5.14 `capture` takes the flag `--retries N`, an integer from 0 to 2. Without it, or with 0, nothing changes (R5.1). With N above 0, `capture` must try a failed cell again up to N times, only for a transient error. An error is transient only when it is a Playwright `TimeoutError`, the capture deadline, or a Chromium network error from the list in this record: `ERR_CONNECTION_RESET`, `ERR_CONNECTION_CLOSED`, `ERR_CONNECTION_TIMED_OUT`, `ERR_TIMED_OUT`, `ERR_EMPTY_RESPONSE`, `ERR_NETWORK_CHANGED`. It must never retry `REMOTE_EDGE_STOP` or `RUN_STOPPED` (R3.6), a request-policy block (R3.7, R3.9), a page response with status 4xx, a failure of the content, behavior or pack artifacts, a crash of the browser or the page, or any error when an edge stop, a block or an unexpected navigation is set. Before attempt n + 1 the capture must wait 1000 ms × n. Each attempt uses a fresh context. A cell that succeeds on a retry is stored as a normal `captured` entry with the warning `CAPTURE_RETRIED` and `count` = the retries used (R5.11). A cell that fails on its last attempt is stored as `failed`, its `error.message` states the number of attempts, the run state is `partial` and the exit status is 1 (R8.7). A retry and the flag enter no hash and no `recipe`. A run with no retry stores the same bytes as before.

R8.7 and R8.16 need no change. The state `kept` does not exist: a kept cell is `captured`, and the proof of equal recipes (R8.16) is part of eligibility.

## Consequences

If accepted:

- `run.json` gains one optional entry key, `kept`, and two warning codes. `schemaVersion` stays 2. `docs/seam.md` gets a row.
- `capture` gets two opt-in flags. `run`, `before` and `after` stay as they are until the owner says otherwise (open question 8).
- The slice needs these tests, each failing without the change: eligibility (one miss for each of the seven rules), a kept entry equals a fresh entry in `recipe` and hashes, an A/A pair with a kept side is `complete` and `match`, a raise of `recipe.version` makes the cell fresh, a copy refuses a path outside the source directory and a symbolic link, each transient class retries, each never-retried class does not, no retry after an edge stop, the exit status and run state after the last failed attempt, and no hash change in any case.
- The slice runs on local synthetic pages only (`example-site`), as #49 states. The refusal on a local side (rule 7) makes the keep tests use a `remote: true` side that points to a local synthetic origin. This is allowed by R3.3, and the slice must show that it works.
- Not measured: the disk cost of K2, and the run time added by a retry on a real remote origin. Both are estimates until a slice ships.

## Open questions for the owner

1. Keep model. Do you accept K2 (copy with provenance) over K1 (pointer) and K3 (no keep in `capture`)?
2. Eligibility. Do you accept the seven rules, in particular the equal stored side and target declaration (rules 1 and 3), which go beyond the settings hash?
3. Which sides may keep? Recommended: `remote: true` only. The other options are any side (a local `after` capture could then read as `match` against changed code) or a per-side opt-in key in the config.
4. Source runs. Recommended: only runs with state `complete`. Should a `partial` run also supply the cells it captured? That serves a resumed reference harvest, but it conflicts with the spirit of R13.13 ("Partial captures cannot replace a complete baseline").
5. Retry bound. Recommended: `--retries` from 0 to 2, default 0, with a wait of 1000 ms × the attempt number. What maximum and what wait did the legacy tooling use? The legacy files are not on this machine, so the agent cannot read them.
6. Is a refused connection (`ERR_CONNECTION_REFUSED`) transient? Recommended: no, because it usually means a stopped server.
7. Is a 5xx page response transient? Recommended: no. It stays a stored result with its status code.
8. Should `run`, `before` and `after` pass `--keep-existing` and `--retries` through, or stay out until a project asks? Recommended: stay out for 1.3. `before --side production` is a baseline command, and the interaction of keep with the stored baseline (R13.13) needs its own check.
9. FORCE. Do you accept F1 (no FORCE in the core, the alias maps it) over F2 (`--force` flag) and F3 (per-target list)?
10. Visibility. Do you accept the warning pipeline (R5.11) as the only visibility for slice 6, with `REFERENCE_KEPT` and `CAPTURE_RETRIED` as new codes and no new viewer element? Should the stderr line also start with `Warning REFERENCE_KEPT:` and `Warning CAPTURE_RETRIED:`, as it does for `LAZY_IMAGES_NOT_SWEPT`? This record proposes the plain line `Kept N of M captures from earlier runs.` and leaves retries without a stderr line.
11. Age. Should keep refuse an entry older than a limit (a flag such as `--keep-max-age`)? Recommended: no limit in 1.3. `kept.at` makes the age visible, and a person who wants a fresh reference omits the flag.
12. Requirement numbers. Do you accept R5.13 and R5.14 as the numbers, and a Tier 3 pull request for the specification text that the owner approves and merges?

## Decision

None yet. The owner answers the questions above. This record changes to "accepted" with a "Decision" section, as ADR 0007 did, after the answer.
