# src/compare

One comparator per artifact kind, normalisers with evidence, the noise floor. Spec sections 6 and 8.

`compareRuns` reads two stored runs and writes a screenshot report. It preserves originals. It rejects incompatible settings and tool versions. It limits manifest and PNG input sizes. The explicit browser integration checks verify repeated captures and a changed target.

Response artifacts use bounded sidecars and a linear HTML replacement window.
A status pair creates a finding when the final status, the final path or the redirect chain differs (R6.13). Asset counts do not.
Requested artifact failures keep measurement incomplete, a `status` failure too (R8.7).

`readRun` validates a recorded `selection`. A cell outside a recorded selection of either run, or outside the
optional `filter` (`{ targets, viewports }`), is skipped and counted in `meta.skipped`. The report records
`meta.scope`. A selected cell without a capture stays `missing`. A run without `selection` skips nothing (R4.5).


Comparison takes optional validated rules and pair-scoped known differences.
It retains raw findings and attaches verified evidence acceptance. Policy does not
change screenshot capture hashes. See `src/rules/README.md` (R8.4–R8.6).
