# src/compare

One comparator per artifact kind, normalisers with evidence, the noise floor. Spec sections 6 and 8.

`compareRuns` reads two stored runs and writes a screenshot report. It preserves originals. It rejects incompatible settings and tool versions. It limits manifest and PNG input sizes. The explicit browser integration checks verify repeated captures and a changed target.

`compareRuns` copies the valid `warnings` of each capture to `row.warnings` as `{ a, b }` (R5.11). A bad stored value is ignored as a whole and adds nothing.

Response artifacts use bounded sidecars and a linear HTML replacement window.
A status pair creates a finding when the final status, the final path or the redirect chain differs (R6.13). Asset counts do not.
Requested artifact failures keep measurement incomplete, a `status` failure too (R8.7).

`readRun` validates a recorded `selection`. A cell outside a recorded selection of either run, or outside the
optional `filter` (`{ targets, viewports }`), is skipped and counted in `meta.skipped`. The report records
`meta.scope`. A selected cell without a capture stays `missing`. A run without `selection` skips nothing (R4.5).


Comparison takes optional validated rules and pair-scoped known differences. It also takes the parsed `allowlistEntries` and the clock `now` (R9.12). It validates the entries before the output directory exists, fingerprints each absolute finding from the evidence of its check (a content finding in `compareRuns`, a pack finding in `packs.js`), and writes `report.allowlist` with the status of each entry before it validates the report. The `lighthouse-budget` finding has no fingerprint and stays `unexplained` (R9.12).
It retains raw findings and attaches verified evidence acceptance. Policy does not
change screenshot capture hashes. See `src/rules/README.md` (R8.4–R8.6).

A pair may hold a design run (R8.15). Its cells are `incompatible` when the viewports differ or the image width is not the viewport width times the device scale, and the diagnostic names both sizes. A cell with no image is `missing`. A pair with a design run reads as `convergence` unless `--kind` says otherwise. `--kind drift` needs two design runs of one design side, else it fails before the output directory exists (R3.12). `diff` checks the sha256 of a design image against the record of the import. See `src/design/README.md`.

Comparison also takes the parsed `decisionEntries` (R9.14). It validates them and their fingerprints before the output directory exists. In a pair with a design run it fingerprints the design value of each layout difference, writes `report.decisions` with the status of each entry and puts the label on each layout finding. See `src/decisions/README.md`.

`packs.js` reads the pack results that `capture --packs` stored in run B (R13.51). It runs the pack checks over each stored sidecar and writes an absolute artifact index (R9.9), findings and a catalog entry. Only side B enters the report. A run with no stored pack result adds nothing (R5.1).
