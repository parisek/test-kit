# src/query

`summary.js` exports the pure `summarizeReport` query. It shares classification
with the viewer. Lists are bounded; aggregate counts cover the full report.
Other section 11 queries remain planned.

artifact.js exports queryArtifact(reportPath, {target, viewport, artifact, maxLines}).
HTML uses a bounded replacement window. HTTP status uses a fixed metadata schema.

The query command returns bounded HTML windows or HTTP metadata (R11.1).
It requires a target, viewport, and artifact. It strips unknown sidecar fields.
The artifacts `lint` and `a11y` are absolute results (R9.9). They need no viewport. A lint result sits at target scope. Their query returns the artifact `result`, `scope` and `evidence` path, and reads no sidecar.
`summarizeReport` returns `pair` or `subject`, and `null` for the other (R11.6).


Artifact query returns the ordered pair key, at most 50 scoped rules, bounded
rule text and evidence, and an omitted-rule count. Raw and normalized windows
use the same requested display-line cap (R11.6).

Every `summary` and `query` answer stays under one byte limit, `OUTPUT_BYTE_LIMIT` in `bound.js` (60000 bytes, the first limit of the behavior query). It implements the size limit of R11.2. `summary` copies the documented keys of `pair`. It cuts a target id to 200 characters, ends it with an ellipsis and sets `idTruncated`, so `--target` with that id does not match. `query` halves the longest list of the difference first (lines, findings, steps, redirects). If the answer still does not fit, it drops the difference and sets `diffOmitted`. Only then does it cut the rules and `scope.checks`, so an oversize difference does not cost the rules. Each cut adds an omitted count (`omitted`, `checksOmitted`, `rulesOmitted`, `redirectsOmitted`).
