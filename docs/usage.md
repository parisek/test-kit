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


## Response evidence

Screenshots remain the default. Enable HTML or HTTP metadata explicitly:

```sh
test-kit capture --side local --label before --artifacts screenshot,html,status
test-kit capture --side local --label after --artifacts screenshot,html,status
test-kit diff <run-a> <run-b> --output tests/visual/report
test-kit query tests/visual/report/report.json --target home --viewport desktop --artifact html --max-lines 40
test-kit query tests/visual/report/report.json --target home --viewport desktop --artifact status
```

One navigation supplies all requested artifacts. HTML holds the server response,
not the DOM after scripts. Raw HTML stays local. The viewer displays text only.
A line window is a bounded replacement span. It is not a minimal edit script.
Normalization runs only from an explicit evidenced rules catalog.
The query reports displayed and omitted lines for raw and normalized windows.
The line limit is 1 to 100. Unknown target or viewport identifiers fail.

HTML and status can also run alone. Status never determines target class.
A status-only report has the verdict no-comparable-evidence. A failed requested
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
HTTP status and oracle classification keep their existing contracts.

Record an observed screenshot or HTML difference through the CLI:

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
