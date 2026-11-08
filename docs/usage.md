# Local capture and comparison workflow

Requirements: R4.1, R11.1–R11.6, R12.4.
Configure local sides and an explicit target list in `test-kit.config.json`.
The configuration resolves paths from its own directory. Keep runs outside git.
Use Chromium on the host to visit the local DDEV origin. Install the package in
the project container. Flush pending file synchronization before capture.

Capture the baseline before a change. Capture the current state after it.
Compare the stored runs. No comparison command visits the site again.

```sh
test-kit capture --side local --label before
test-kit capture --side local --label after
test-kit diff <run-a> <run-b> --output tests/visual/report
test-kit summary <report.json> --filter all --max-targets 20
test-kit serve <report.json>
```

The CLI prints run IDs and output paths. Use those paths in later commands.
The viewer and summary use the same classifier. A matching screenshot can have
an HTTP availability error. Incomplete or incompatible evidence is reported
separately. Fix capture errors before interpreting the comparison.

Summary limits target lists, not aggregate counts. Each list records omissions.
Use `--filter unexplained`, `--filter incomplete`, or `--target <id>` to narrow
output. `--max-targets` accepts integers from 1 to 1000. `next` suggests a
supported follow-up. No known difference is accepted through the viewer.

The report server binds to loopback. It serves a fixed compiled viewer, the chosen
report, and indexed PNG or response sidecar paths. Shared classification logic
is bundled into the viewer. Assets must reside inside the report directory. It does not list directories
or expose project configuration, arbitrary JSON, or files outside that directory.
Only GET and HEAD are supported. Response sidecars have a 2 MiB size limit.
Other served files have an 80,000,000 byte size limit.
Stop the command after review. Client evidence stays local.


## Compare a subset

`capture` and `diff` take `--target ID,ID` and `--viewport ID,ID` (R4.5). The configuration stays whole.

```sh
test-kit capture --side local --label before --target home,contact --viewport desktop
test-kit capture --side local --label after
test-kit diff <run-a> <run-b> --output tests/visual/report
test-kit diff <run-a> <run-b> --output tests/visual/report --target home
```

A selected run captures only the selected cells. It keeps the full lists and the same settings hash, and it
records `selection` in `run.json`. `diff` compares the cells that every recorded selection holds and counts the
rest in `meta.skipped`. A selected cell without a capture stays `missing`. A run made before this option has no
`selection`, and `diff` treats it as a full run. `diff --target` and `--viewport` narrow the pair again.

## Keep a reference from an earlier run

`capture --keep-existing` fills a cell from an earlier run of the store instead of loading the page (R5.13). It works only on a side with `remote: true`.

```bash
test-kit capture --side production --label reference --keep-existing
```

An earlier capture stands for a cell only when it is provably the capture that this run would make: the same side declaration, settings, browser versions, target declaration and recipe, and a `complete` source run. Any difference captures the cell fresh. A cell of a run that selects `behavior` is always fresh. The command copies the files into the new run, so the run stays whole if you delete the old one.
A kept capture is not a new measurement. Its entry has `kept: { runId, at }`, where `at` is the time of the measurement, and the warning `REFERENCE_KEPT`. The command prints `Warning REFERENCE_KEPT:` on stderr and adds `kept` (a count) to the JSON line when it kept at least one cell.
There is no age limit and no FORCE flag. To refresh a reference, run `capture` without the flag. `run`, `before` and `after` do not take the flag.

## Retry a flaky capture

`capture --retries N` tries a failed cell again, up to N times. N is 0, 1 or 2. The default is 0 (R5.14).

```bash
test-kit capture --side production --label after --retries 2
```

A retry runs for a transient error only: a timeout, or a reset, closed or timed-out connection. A refused connection, a DNS failure, a 4xx or 5xx page, an edge stop (R3.6) and a policy block are never retried.
The capture waits 1 s before the first retry and 2 s before the second. Each cell has its own count.
A cell that succeeds on a retry is a normal capture with the warning `CAPTURE_RETRIED`. The command prints `Warning CAPTURE_RETRIED:` on stderr, and the viewer shows the warning (R5.11).
A cell that fails on its last try stays `failed`, the run stays `partial` and the exit status is 1.
The flag changes no hash. `run`, `before` and `after` do not take it.

## Compare with supplied design images

A side of kind `design` holds PNG files that a person or a design tool supplies (R5.5). The files stay local. No network is used.

```json
"sides": {
  "design": { "kind": "design", "provider": "files", "root": "design-refs" },
  "local": { "origin": "https://example-site.ddev.site" }
},
"targets": [
  { "id": "hero", "kind": "component", "path": "/styleguide/render/component/hero?canvas",
    "design": { "desktop-1280": "hero/desktop-1280.png", "mobile-390": "hero/mobile-390.png" } }
]
```

A path in `design` is relative to `root`: this example reads `design-refs/hero/desktop-1280.png`.

```sh
test-kit capture --side local --label after --artifacts screenshot
test-kit import --side design --label refs
test-kit diff <design-run> <local-run> --output tests/visual/report
```

### Figma

A design side can read from Figma instead of from files. This is opt-in. It is the one place where the tool talks to a hosted service, and it does so only during `import`.

```json
"sides": { "design": { "kind": "design", "provider": "figma", "fileKey": "<file key from the Figma URL>" } },
"targets": [ { "id": "hero", "kind": "component", "path": "/hero", "design": { "desktop-1280": "12:34", "mobile-390": "12:56" } } ]
```

Each value in `design` is a Figma node ID: `12:34`, not `12-34` as in a URL. Make a Figma personal access token that can read the file. Pass it in the environment, never in the configuration:

```sh
FIGMA_TOKEN=... test-kit import --side design --label refs
```

`import` exports each node as PNG at the device scale of its viewport, so the frame must be as wide as the viewport (a 1280 px viewport needs a 1280 px frame). It never resizes an image: a frame of another width reads `incompatible` in `diff`. Without `FIGMA_TOKEN`, `import` fails before it makes a request. `diff` and every other command stay offline.

### Claude Design

A design side can render a canvas from Claude Design. The input is a local export, never the hosted canvas, so the tool needs no account and opens no connection that leaves the machine.

Export the canvas project into a directory, for example `design-canvas/`. The directory holds the artboards `project/<name>.dc.html` and their support files under `project/`. It also holds `project/canvas.json`, which `import` does not read. An artboard loads its files with relative paths (`./support.js`, `ds/tokens.css`). Save the canvas runtime beside the artboards as `project/support.js`. test-kit never ships or downloads the runtime: it has no stated licence. Keep the export out of git when it holds client work.

```json
"sides": { "design": { "kind": "design", "provider": "claude-design", "root": "design-canvas" } },
"targets": [ { "id": "hero", "kind": "component", "path": "/hero",
  "design": { "desktop-1280": "Example.dc.html##hero", "mobile-390": "ExampleMobile.dc.html" } } ]
```

A value is an artboard file name directly in `project/`, and optionally `#` and a CSS selector. The text after the first `#` is the whole selector, so an element ID needs its own `#`: `Example.dc.html##hero`. Without a selector, `import` captures the full artboard. With one, it captures the band of the page that holds the one matched element.

`import` serves `project/` on `127.0.0.1`, renders each artboard in Chromium at the viewport width and device scale with motion off. It aborts every other HTTP request, closes WebSockets, and removes WebRTC from the page before any artboard script runs. It waits until no `{{` hole is left in the text and every `x-import` element has content. An artboard that does not get there within `screenshot.timeoutMs` fails the import by target name, and no run is written. Each image is the viewport wide, so a pair with a captured run never reads `incompatible` for its width. The provenance adds the sha256 of the artboard and of the runtime, so history shows when the canvas or its runtime changed.

`import` writes a run with the sha256, size, source path and import time of each image (R4.6). A new import after a design change is a new run. `diff` reads the pair as `convergence`. A viewport with no mapped file is `missing`, never `match`. An image whose width is not the viewport width times the device scale is `incompatible`, and the report names both sizes. The tool never crops or resizes an image (R8.15). Read `diff.regions` first: a design tool and a browser draw text in different ways, so the ratio is a compass.

## Response evidence

Screenshots remain the default. Enable HTML or HTTP metadata explicitly:

```sh
test-kit capture --side local --label before --artifacts screenshot,html,status
test-kit capture --side local --label after --artifacts screenshot,html,status
test-kit diff <run-a> <run-b> --output tests/visual/report
test-kit query tests/visual/report/report.json --target home --viewport desktop --artifact html --max-lines 40
test-kit query tests/visual/report/report.json --target home --viewport desktop --artifact status
test-kit query report.json --target @project --artifact lint   # an absolute result needs no viewport (R9.9)
```

One navigation supplies all requested artifacts. HTML holds the server response,
not the DOM after scripts. Raw HTML stays local. The viewer displays text only.
A line window is a bounded replacement span. It is not a minimal edit script.
Normalization runs only from an explicit evidenced rules catalog.
The query reports displayed and omitted lines for raw and normalized windows.
The line limit is 1 to 100. Unknown target or viewport identifiers fail.

HTML and status can also run alone. A difference in the final status, the final
path or the redirect chain is a finding, so the target is not `match` (R6.13).
Equal status evidence adds no class. A status-only report has the verdict
no-comparable-evidence. A failed requested
HTML artifact remains incomplete even when screenshot pixels match.
See [the response contract](contracts.md#opt-in-response-artifacts-after-v01).


## Evidenced comparison policy

Rules run at comparison time. Capture originals remain unchanged (R8.6).
Add a `rules` object to the JSON configuration. Each rule needs a short `text`,
a nonempty `evidence` statement, an `applies` scope, and a literal-pair operation.
The following example uses observed synthetic response values:

```json
{
  "response-token": {
    "text": "The local response token changes between these runs.",
    "evidence": "Both captured responses contain one observed token.",
    "applies": { "artifacts": ["html"], "kinds": ["migration"], "targets": ["home"] },
    "operation": { "kind": "literal-pair", "a": "token-before", "b": "token-after", "maxOccurrences": 1 }
  }
}
```

Every supplied axis must match. An omitted axis is unrestricted. An empty array
matches nothing. `pairs` accepts the ordered pair key returned by artifact query.
Set this axis to restrict a catalog rule to one pair. A broader catalog rule can
run on later pairs. No rule runs by default. Rules do not contain regular expressions.
Each side must have the same nonzero occurrence count, within `maxOccurrences`.
Overlaps, token collisions, and exceeded limits leave the raw difference visible.
The comparison records fired rules, diagnostics, raw hashes, and policy provenance.
Raw and normalized windows share a 2 MiB serialized JSON limit. Omitted counts
include lines removed to meet this limit. These windows are display evidence.
Acceptance uses full raw bytes, not the displayed window.

A fully normalized raw difference remains a finding with the class `explained`.
A remaining normalized difference is `unexplained`. Failed evidence stays incomplete.
Oracle classification keeps its existing contract.

Record an observed screenshot, HTML, status or content difference through the CLI. Use
`--artifact status` for an intended redirect, for example a trailing slash:

```sh
test-kit record-known tests/visual/report/report.json --config test-kit.config.json --target home --viewport desktop --artifact html --cause response-token --reason 'The observed token differs in this exact pair.'
test-kit diff <run-a> <run-b> --config test-kit.config.json --output tests/visual/reviewed
```

The command verifies bounded local source files and their report copies. It records
one exact ordered pair, target, viewport, artifact, full raw hashes, effective capture
provenance, and comparison policy. Reversed pairs, new runs, changed raw files,
and changed policy need new evidence. It does not rewrite an existing report.
The configuration update uses an atomic rename and an optimistic original-byte
check. A concurrent change detected before rename fails without overwriting it.
This check is not a lock across other writers.

## Allowlist for absolute findings

A known difference (above) covers a relative finding. An absolute finding, such as a missing `h1` or an axe violation, has no pair. Allow it with an entry in `test-kit.allowlist.json` beside the config (R9.12). The entry names the check, the target, a fingerprint of the finding evidence, a reason and an owner.

Read the fingerprint from `report.json` and add the entry with the command:

```sh
test-kit record-allowed tests/visual/reviewed/report.json --target home --check heading-outline --viewport desktop \
  --reason 'The home page shows a logo, not a text heading.' --owner example-team --expires 2027-03-31
test-kit diff <run-a> <run-b> --config test-kit.config.json --output tests/visual/reviewed-2
```

Commit the file. `diff` and `after` read it. The new report marks a matching finding `explained`. If the evidence changes, the fingerprint changes. The finding is `unexplained` again, and the old entry shows as `stale` in `report.allowlist`, `summary` and `query`. An entry past its `expires` date shows as `expired` and explains nothing. A stale or an expired entry does not fail the run. Nothing removes an entry: a person edits the file.

`record-allowed` refuses an oracle target, a relative check, an artifact that is not `complete` and a duplicate. It needs exactly one finding for the check, target and viewport. With two findings of one check, the error lists their fingerprints. Add `--fingerprint HASH` to pick the one finding that has this fingerprint. The command refuses a value that is not a hash and a value that matches no finding. The flag `--allowlist FILE` sets another path.

A speed budget finding (`lighthouse-budget`) has no fingerprint and takes no entry. `record-allowed` refuses it. Change the budget in the config instead.
